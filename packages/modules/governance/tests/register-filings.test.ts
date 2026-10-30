import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createRegisterFiling, getRegisterFiling, listRegisterFilings, listRegisterOccasions, updateRegisterFiling, addFilingOccasions } from '../src/register/filings';
import { governanceRegisterFilings, governanceRegisterOccasions } from '../src/schema';
import { endTerm, listTerms } from '../src/terms';
import { systemContext } from '@kompass/core/testing';
import { governanceRecordDeleted } from '../src/record-deleted';
import { auditOf, holders, officeOf, person, setupGovernance } from './helpers';

/** Zwei Rücktritte aus vertretenden Ämtern am 31.05. → zwei gespeicherte Anlässe. */
async function twoOccasions() {
  const setup = setupGovernance();
  const { deps, ctx } = setup;
  await holders(deps, ctx, ['chair', 'treasurer']);
  for (const fn of ['chair', 'treasurer'] as const) {
    const [term] = unwrap(await listTerms(deps, ctx, { officeId: officeOf(deps, fn) }));
    unwrap(await endTerm(deps, ctx, { id: term!.id, until: '2026-05-31', reason: 'resigned', receivedOn: '2026-05-20' }));
  }
  const ids = deps.db.select().from(governanceRegisterOccasions).all().map((o) => o.id);
  return { ...setup, ids };
}

describe('register filings', () => {
  it('bundles two occasions (due, overdue after 28 days), then notary and submission', async () => {
    const { deps, ctx, ids } = await twoOccasions();
    expect(unwrap(await listRegisterOccasions(deps, ctx, {})).map((o) => o.id).sort()).toEqual([...ids].sort());
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: ids.map((id) => ({ id })) }));
    expect(filing).toMatchObject({ state: 'due', overdue: true });
    expect(filing.occasions.map((o) => o.id).sort()).toEqual([...ids].sort());
    expect(unwrap(await listRegisterOccasions(deps, ctx, {}))).toEqual([]);
    expect(auditOf(deps, 'governance.register.create').at(-1)!.params).toEqual({ occasions: 2 });

    const notary = await person(deps, 'Notarin');
    const atNotary = unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notaryContactId: notary, notarizedOn: '2026-06-10' }));
    expect(atNotary).toMatchObject({ state: 'atNotary', overdue: false, notaryContactId: notary });
    expect(auditOf(deps, 'governance.register.update').at(-1)!.params).toEqual({ fields: 'notaryContactId, notarizedOn' });
    expect(unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, submittedOn: '2026-06-12' })).state).toBe('submitted');
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).state).toBe('submitted');
    expect(unwrap(await listRegisterFilings(deps, ctx, { states: ['due'] }))).toEqual([]);
    expect(unwrap(await listRegisterFilings(deps, ctx, {})).map((f) => f.id)).toEqual([filing.id]);
  });

  it('an occasion belongs to at most one filing; occasions join until registration', async () => {
    const { deps, ctx, ids } = await twoOccasions();
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: ids[0]! }] }));
    expect(await createRegisterFiling(deps, ctx, { occasions: [{ id: ids[0]! }] })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'occasionFiled' } });
    expect(await createRegisterFiling(deps, ctx, { occasions: [{ id: 'fehlt' }] })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    // Nichts angelegt bei einem Fehler mittendrin.
    expect(await createRegisterFiling(deps, ctx, { occasions: [{ id: ids[1]! }, { id: ids[0]! }] })).toMatchObject({ ok: false, error: { code: 'occasionFiled' } });
    expect(deps.db.select().from(governanceRegisterFilings).all()).toHaveLength(1);

    expect(unwrap(await addFilingOccasions(deps, ctx, { filingId: filing.id, occasions: [{ id: ids[1]! }] })).occasions).toHaveLength(2);
    expect(auditOf(deps, 'governance.register.addOccasions').at(-1)!.params).toEqual({ count: 1 });
    deps.db.update(governanceRegisterFilings).set({ registeredOn: '2026-07-01' }).where(eq(governanceRegisterFilings.id, filing.id)).run();
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).state).toBe('registered');
    expect(await updateRegisterFiling(deps, ctx, { id: filing.id, note: 'x' })).toMatchObject({ ok: false, error: { code: 'filingRegistered' } });
    expect(await addFilingOccasions(deps, ctx, { filingId: filing.id, occasions: [{ id: ids[1]! }] })).toMatchObject({ ok: false, error: { code: 'filingRegistered' } });
  });

  it('a deleted notary contact leaves the filing without reference', async () => {
    const { deps, ctx, ids } = await twoOccasions();
    const notary = await person(deps, 'Notar');
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: ids[0]! }] }));
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notaryContactId: notary }));
    deps.db.transaction((tx) => governanceRecordDeleted(tx, deps, systemContext(), 'contact', notary));
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).notaryContactId).toBeNull();
    expect(auditOf(deps, 'governance.register.notaryRemoved')).toHaveLength(1);
  });

  it('refuses without governance.manage, a submission before the notary, and an empty bundle', async () => {
    const { deps, ctx, userId, ids } = await twoOccasions();
    expect(await createRegisterFiling(deps, ctxWith(['governance.read'], userId), { occasions: [{ id: ids[0]! }] })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await listRegisterOccasions(deps, ctxWith([], userId), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await createRegisterFiling(deps, ctx, { occasions: [] })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await createRegisterFiling(deps, ctx, { occasions: [{ id: ids[0]!, termId: 'x' }] })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: ids[0]! }] }));
    expect(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: '2026-06-10', submittedOn: '2026-06-09' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: '2026-06-10' }));
    expect(await updateRegisterFiling(deps, ctx, { id: filing.id, submittedOn: '2026-06-09' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('submitted without notarization (G-24)', () => {
  it('warns notarizationMissing until the notarization day is recorded', async () => {
    const { deps, ctx, ids } = await twoOccasions();
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: ids.map((id) => ({ id })) }));
    expect(unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, submittedOn: '2026-06-10' })).warnings).toContain('notarizationMissing');
    expect(unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: '2026-06-05' })).warnings).not.toContain('notarizationMissing');
  });
});
