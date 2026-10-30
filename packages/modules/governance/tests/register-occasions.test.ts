import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createRegisterFiling, listRegisterOccasions } from '../src/register/filings';
import { openOccasionsInternal } from '../src/register/occasions-open';
import { governanceOffices, governanceRegisterOccasions } from '../src/schema';
import { endTerm, startTerm } from '../src/terms';
import { officeOf, person, setupGovernance } from './helpers';

/** Vorsitz 24 Monate seit 2024-01-01 (endet 2025-12-31); `untilSuccessor` wie angegeben. Heute ist 2026-09-05. */
async function expiredChair(untilSuccessor: boolean, successorSince?: string) {
  const setup = setupGovernance();
  const { deps, ctx } = setup;
  const officeId = officeOf(deps, 'chair');
  deps.db.update(governanceOffices).set({ untilSuccessor }).where(eq(governanceOffices.id, officeId)).run();
  const term = unwrap(await startTerm(deps, ctx, { officeId, contactId: await person(deps, 'Alt'), since: '2024-01-01', origin: 'backfilled' }));
  if (successorSince) unwrap(await endTerm(deps, ctx, { id: term.id, until: '2025-12-31', reason: 'expired' }));
  if (successorSince) unwrap(await startTerm(deps, ctx, { officeId, contactId: await person(deps, 'Neu'), since: successorSince, origin: 'backfilled' }));
  return { ...setup, officeId, termId: term.id };
}

describe('open register occasions', () => {
  it('an expired representative term without „until successor“ and without successor is a computed board change', async () => {
    const { deps, ctx, officeId, termId } = await expiredChair(false);
    expect(openOccasionsInternal(deps.db, '2026-09-05')).toEqual([{ id: null, kind: 'boardChange', occurredOn: '2026-01-01', termId, officeId, statuteId: null, meetingId: null, resolutionId: null }]);
    // Am letzten Tag läuft das Amt noch.
    expect(openOccasionsInternal(deps.db, '2025-12-31')).toEqual([]);
    expect(unwrap(await listRegisterOccasions(deps, ctx, {}))).toHaveLength(1);
  });

  it('none with „until successor“ or with a successor', async () => {
    expect(openOccasionsInternal((await expiredChair(true)).deps.db, '2026-09-05')).toEqual([]);
    expect(openOccasionsInternal((await expiredChair(false, '2026-01-01')).deps.db, '2026-09-05')).toEqual([]);
  });

  it('bundling stores the computed occasion as a row of the filing; it is no longer open', async () => {
    const { deps, ctx, termId } = await expiredChair(false);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ termId }] }));
    expect(filing.occasions).toEqual([expect.objectContaining({ kind: 'boardChange', occurredOn: '2026-01-01', termId, filingId: filing.id })]);
    expect(deps.db.select().from(governanceRegisterOccasions).all()).toHaveLength(1);
    expect(openOccasionsInternal(deps.db, '2026-09-05')).toEqual([]);
    expect(await createRegisterFiling(deps, ctx, { occasions: [{ termId }] })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});

describe('a resolved statute stand as an occasion (G-15)', () => {
  it('a stand resolved by hand after the first registration is a computed occasion; bundling stores it', async () => {
    const { createStatuteDraft, registerStatute, updateStatute } = await import('../src/statutes');
    const { deps, ctx } = setupGovernance();
    const first = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id: first, resolutions: [{ on: '2024-03-01', resolutionId: null }] }));
    unwrap(await registerStatute(deps, ctx, { id: first, registeredOn: '2024-05-01' }));
    expect(openOccasionsInternal(deps.db, '2026-09-05')).toEqual([]);
    const second = unwrap(await createStatuteDraft(deps, ctx, { basedOnId: first })).id;
    unwrap(await updateStatute(deps, ctx, { id: second, resolutions: [{ on: '2026-06-15', resolutionId: null }] }));
    expect(openOccasionsInternal(deps.db, '2026-09-05')).toEqual([{ id: null, kind: 'statute', occurredOn: '2026-06-15', termId: null, officeId: null, statuteId: second, meetingId: null, resolutionId: null }]);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ statuteId: second }] }));
    expect(filing.occasions).toEqual([expect.objectContaining({ kind: 'statute', statuteId: second, filingId: filing.id })]);
    expect(openOccasionsInternal(deps.db, '2026-09-05')).toEqual([]);
  });
});
