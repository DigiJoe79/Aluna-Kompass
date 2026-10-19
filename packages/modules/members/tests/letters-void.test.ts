import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { documents, voidDocument } from '@kompass/module-dms';
import { FINANCE_PERMISSIONS } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { continueDunningRun, previewDunningRun, startDunningRun } from '../src/dunning';
import { setFeeAgreement } from '../src/fee-agreement';
import { admitMember, recordApplication } from '../src/memberships';
import { markRunPostDispatched, runDispatchState } from '../src/run-dispatch';
import { memberFeeCharges } from '../src/schema';
import { addressedPerson, enteredOn, MEMBERS_PERMISSIONS, setupFees } from './helpers';

// Plan N2 Task 5 (F7, Entscheidung Joe 2026-10-19): Unversandte Mitglieder-Briefe sind stornierbar wie andere Dokumente.
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

async function setup(now = '2026-10-18T08:00:00.000Z') {
  const env = await setupFees({ now, validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS, 'dms.view', 'dms.void'] });
  env.deps.db.transaction((tx) => {
    writeSettingInternal(tx, env.deps, systemContext(), 'organization.name', 'Musterverein e.V.');
    writeSettingInternal(tx, env.deps, systemContext(), 'organization.iban', 'DE23999999990000202051');
  });
  return env;
}

describe('Mitglieder-Briefe stornieren (F7)', () => {
  it('an unsent letter can be voided in the file; a sent one is refused with a sentence', async () => {
    const { deps, ctx, types } = await setup();
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.supporting, appliedOn: '2026-09-20' }));
    const member = unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2026-10-01' }));
    const letterId = (member.letter as { documentId: string }).documentId;
    expect(unwrap(await voidDocument(deps, ctx, { id: letterId, reason: 'Falsche Anschrift' }))).toMatchObject({ status: 'voided' });

    const second = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Zwei' }), typeId: types.supporting, admittedOn: '2026-10-01', letter: true }));
    const sentId = (second.letter as { documentId: string }).documentId;
    deps.db.update(documents).set({ sentAt: '2026-10-18', sentVia: 'post' }).where(eq(documents.id, sentId)).run();
    expect(fail(await voidDocument(deps, ctx, { id: sentId, reason: 'zu spät' }))).toMatchObject({ type: 'conflict', code: 'documentAlreadySent' });
  });

  it('a voided letter that asked to transfer no longer keeps the fee on transfer', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.supporting, admittedOn: '2026-10-01', letter: true }));
    unwrap(await voidDocument(deps, ctx, { id: (member.letter as { documentId: string }).documentId, reason: 'Fehler' }));
    const set = unwrap(await setFeeAgreement(deps, ctx, { membershipId: member.id, validFrom: '2026-11-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Beispiel' }));
    expect(set.transferKept).toEqual([]);
    const charges = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).all().filter((c) => c.state === 'created');
    expect(charges.every((c) => c.paymentMethod === 'directDebit')).toBe(true);
  });

  it('a voided reminder no longer counts as level; the run shows it as voided and does not send it (Review Focus 3)', async () => {
    const { deps, ctx, types } = await setup('2026-01-20T08:00:00.000Z');
    const member = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Mahnfall' }), typeId: types.regular, admittedOn: '2026-01-01', letter: false }));
    enteredOn(deps, '2025-12-01');
    const run = unwrap(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    unwrap(await continueDunningRun(deps, ctx, { runId: run.id, max: 50 }));
    const runRef = `membersDunningRun:${run.id}`;
    const before = unwrap(await runDispatchState(deps, ctx, { runRef }));
    expect(before.done).toBe(false);
    const reminderId = [...before.mail, ...before.post][0]!.documentId;
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' })).skipped).toEqual([expect.objectContaining({ membershipId: member.id, reason: 'previousNotSent' })]);
    unwrap(await voidDocument(deps, ctx, { id: reminderId, reason: 'Fehler im Betrag' }));
    // Die Stufe zählt nicht mehr: Das Mitglied ist wieder für die Erinnerung reif.
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' })).ready).toEqual([expect.objectContaining({ membershipId: member.id, levelKey: 'reminder' })]);
    const after = unwrap(await runDispatchState(deps, ctx, { runRef }));
    expect([...after.mail, ...after.post]).toEqual([]);
    expect(after.voided).toEqual([expect.objectContaining({ documentId: reminderId, membershipId: member.id })]);
    expect(after.done).toBe(true);
    // V2 (Retest N3): Ohne Auswahl nennt der Satz die Stornos, nicht einen Versandvermerk.
    expect(fail(await markRunPostDispatched(deps, ctx as CallContext, { runRef, sentAt: '2026-01-20' }))).toMatchObject({ type: 'conflict', code: 'runRestVoided' });
    // U6 (Plan N3): Wer den stornierten Brief selbst nennt, hört den wahren Grund.
    expect(fail(await markRunPostDispatched(deps, ctx as CallContext, { runRef, sentAt: '2026-01-20', documentIds: [reminderId] }))).toMatchObject({ type: 'conflict', code: 'runLetterVoided' });
  });

  it('the dispatch step is not done while the run is still running (U11)', async () => {
    const { deps, ctx, types } = await setup('2026-01-20T08:00:00.000Z');
    unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Mahnfall' }), typeId: types.regular, admittedOn: '2026-01-01', letter: false }));
    enteredOn(deps, '2025-12-01');
    const run = unwrap(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    const state = unwrap(await runDispatchState(deps, ctx, { runRef: `membersDunningRun:${run.id}` }));
    expect([...state.mail, ...state.post]).toEqual([]);
    expect(state.done).toBe(false);
  });
});
