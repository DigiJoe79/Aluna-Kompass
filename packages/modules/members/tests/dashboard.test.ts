import { newId, unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { createAccount, FINANCE_PERMISSIONS, financeDirectDebitItems, financeDirectDebitRuns, prepareMandate } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { MEMBERS_DASHBOARD_TILES } from '../src/dashboard';
import { continueDunningRun, startDunningRun } from '../src/dunning';
import { admitMember, recordApplication } from '../src/memberships';
import { markRunPostDispatched } from '../src/run-dispatch';
import { deferCharge } from '../src/fees';
import { memberFeeCharges } from '../src/schema';
import { addressedPerson, enteredOn, MEMBERS_PERMISSIONS, setupFees, type MembersDeps } from './helpers';

const tile = (key: string) => MEMBERS_DASHBOARD_TILES.find((t) => t.key === key)!;
const load = (deps: MembersDeps, ctx: Parameters<(typeof MEMBERS_DASHBOARD_TILES)[number]['load']>[1], key: string) => tile(key).load(deps, ctx, {});

describe('Startseite der Mitglieder (Handoff 2.8)', () => {
  it('Beitragsrückstände: Name und Stufe, Betrag rechts, sortiert nach Stufe, dann Betrag', async () => {
    const env = await setupFees({ now: '2026-01-20T08:00:00.000Z', validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, 'dms.view', ...FINANCE_PERMISSIONS] });
    const { deps, ctx, types } = env;
    expect(await load(deps, ctx, 'arrears')).toEqual({ kind: 'list', lines: [], total: 0, href: '/members/fees' });
    const dunned = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Gemahnt' }), typeId: types.regular, admittedOn: '2026-01-01' }));
    enteredOn(deps, '2025-12-01');
    const run = unwrap(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    unwrap(await continueDunningRun(deps, ctx, { runId: run.id, max: 50 }));
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: `membersDunningRun:${run.id}`, sentAt: '2026-01-20' }));
    const supporting = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Foerder' }), typeId: types.supporting, admittedOn: '2026-01-01' }));
    const content = await load(deps, ctx, 'arrears');
    expect(content).toMatchObject({ kind: 'list', total: 2 });
    const lines = (content as { lines: { titleKey: string; values: Record<string, string>; trailing: string; href: string }[] }).lines;
    expect(lines.map((l) => [l.titleKey, l.values.name, l.values.level, l.trailing, l.href])).toEqual([
      ['line', 'Erika Gemahnt', 'Erinnerung', '12,00 €', `/members/${dunned.id}`],
      ['overdue', 'Erika Foerder', undefined, '10,00 €', `/members/${supporting.id}`],
    ]);
  });

  it('Beitragsrückstände: kein Beitrag im eingereichten Einzug, kein gestundeter vor der neuen Fälligkeit (R7)', async () => {
    const env = await setupFees({ now: '2026-01-20T08:00:00.000Z', validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, 'dms.view', ...FINANCE_PERMISSIONS] });
    const { deps, ctx, types } = env;
    const inRun = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Einzug' }), typeId: types.regular, admittedOn: '2026-01-01' }));
    const deferred = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Gestundet' }), typeId: types.regular, admittedOn: '2026-01-01' }));
    enteredOn(deps, '2025-12-01');
    const run = unwrap(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    unwrap(await continueDunningRun(deps, ctx, { runId: run.id, max: 50 }));
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: `membersDunningRun:${run.id}`, sentAt: '2026-01-20' }));
    const chargeOf = (membershipId: string) => deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, membershipId)).get()!;
    unwrap(await deferCharge(deps, ctx, { chargeId: chargeOf(deferred.id).id, dueOn: '2026-03-31' }));
    // Ein eingereichter Einzug mit dem Beitrag des ersten Mitglieds.
    const account = unwrap(await createAccount(deps, { ...systemContext(), permissions: new Set(FINANCE_PERMISSIONS) }, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const mandate = unwrap(await prepareMandate(deps, ctx, { contactId: inRun.contactId, debtorName: 'Erika Einzug', iban: 'DE44999999990532013000' }));
    const now = '2026-01-20T08:00:00.000Z';
    const runId = newId();
    deps.db.insert(financeDirectDebitRuns).values({ id: runId, collectionDate: '2026-02-02', accountId: account.id, status: 'submitted', messageId: 'MSG-1', submittedOn: '2026-01-19', createdByUserId: 'system', createdAt: now, updatedAt: now }).run();
    deps.db.insert(financeDirectDebitItems).values({ id: newId(), runId, mandateId: mandate.id, source: 'openItem', sourceId: chargeOf(inRun.id).openItemId!, installmentOn: null, amountCents: 1200, endToEndId: 'E2E-1', remittance: 'Beitrag', createdAt: now }).run();
    expect(await load(deps, ctx, 'arrears')).toMatchObject({ lines: [], total: 0 });
  });

  it('Offene Anträge mit dem ältesten', async () => {
    const { deps, ctx, types } = await setupFees({ now: '2026-03-10T08:00:00.000Z' });
    expect(await load(deps, ctx, 'applications')).toEqual({ kind: 'count', count: 0, href: '/members?view=applications' });
    unwrap(await recordApplication(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, appliedOn: '2026-03-01' }));
    unwrap(await recordApplication(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Zwei' }), typeId: types.regular, appliedOn: '2026-03-08' }));
    expect(await load(deps, ctx, 'applications')).toEqual({ kind: 'count', count: 2, href: '/members?view=applications', note: { messageKey: 'oldest', values: { days: 9 } } });
  });

  it('Beiträge des nächsten Jahres ab dem 1. Oktober', async () => {
    const { deps, ctx, types } = await setupFees({ now: '2026-09-30T08:00:00.000Z', validFrom: '2026-01-01' });
    unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    expect(await load(deps, ctx, 'feesYear')).toMatchObject({ tone: 'neutral', messageKey: 'ok', values: { year: 2026 } });
    deps.clock.set('2026-10-01T08:00:00.000Z');
    expect(await load(deps, ctx, 'feesYear')).toEqual({ kind: 'status', tone: 'warning', messageKey: 'missing', values: { year: 2027 }, href: '/members/fees?year=2027' });
    expect(tile('feesYear')).toMatchObject({ permission: 'members.fees', warningAction: true });
  });
});
