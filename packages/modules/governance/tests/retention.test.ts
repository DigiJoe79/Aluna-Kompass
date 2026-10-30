import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { governanceRecordLabels } from '../src/record-labels';
import { governanceRetentionHolds } from '../src/retention';
import { governanceOffices, governanceOrgans } from '../src/schema';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { endTerm, startTerm } from '../src/terms';
import { person, setupGovernance } from './helpers';

describe('governanceRetentionHolds', () => {
  it('holds a contact while a term runs and ten years after it ended', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    const offices = deps.db.select().from(governanceOffices).all();
    const chair = offices.find((o) => o.function === 'chair')!;
    const auditor = offices.find((o) => o.function === 'auditor')!;
    unwrap(await startTerm(deps, ctx, { officeId: chair.id, contactId, since: '2026-07-20', origin: 'backfilled' }));
    const ended = unwrap(await startTerm(deps, ctx, { officeId: auditor.id, contactId, since: '2026-07-20', origin: 'backfilled' }));
    unwrap(await endTerm(deps, ctx, { id: ended.id, until: '2026-12-31', reason: 'expired' }));
    const holds = governanceRetentionHolds(deps, 'contact', contactId);
    expect(holds.map((h) => h.until).sort()).toEqual(['2036-12-31', null].sort());
    expect(holds.every((h) => h.entity === 'governanceTerm')).toBe(true);
    expect(governanceRetentionHolds(deps, 'document', 'x')).toEqual([]);
  });

  it('ends the hold at the end of the tenth year after the term ended mid-year', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    const chair = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    const term = unwrap(await startTerm(deps, ctx, { officeId: chair.id, contactId, since: '2026-07-20', origin: 'backfilled' }));
    unwrap(await endTerm(deps, ctx, { id: term.id, until: '2027-03-15', reason: 'other' }));
    expect(governanceRetentionHolds(deps, 'contact', contactId).map((h) => h.until)).toEqual(['2037-12-31']);
  });
});

describe('governanceRecordLabels', () => {
  it('labels organ, office, term and statute and hides them without governance.read', async () => {
    const { deps, ctx } = setupGovernance();
    const organ = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'board')!;
    const chair = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    expect(governanceRecordLabels(deps, ctx, 'governanceOrgan', organ.id)).toMatchObject({ label: organ.name, state: 'ok' });
    expect(governanceRecordLabels(deps, ctx, 'governanceOffice', chair.id)).toMatchObject({ label: chair.name, state: 'ok' });
    const term = unwrap(await startTerm(deps, ctx, { officeId: chair.id, contactId: await person(deps), since: '2026-07-20', origin: 'backfilled' }));
    expect(governanceRecordLabels(deps, ctx, 'governanceTerm', term.id)).toMatchObject({ label: chair.name, state: 'ok' });
    const statute = unwrap(await createStatuteDraft(deps, ctx, {}));
    unwrap(await updateStatute(deps, ctx, { id: statute.id, resolutions: [{ on: '2026-09-05', resolutionId: null }] }));
    expect(governanceRecordLabels(deps, ctx, 'governanceStatute', statute.id)).toMatchObject({ label: { key: 'governance.records.statute', params: { date: '2026-09-05' } }, state: 'ok' });
    expect(governanceRecordLabels(deps, ctx, 'governanceStatute', 'nope')).toMatchObject({ state: 'missing' });
    const { ctx: none } = setupGovernance([]);
    expect(governanceRecordLabels(deps, none, 'governanceOrgan', organ.id)).toMatchObject({ state: 'forbidden' });
    expect(governanceRecordLabels(deps, ctx, 'contact', 'x')).toBeNull();
  });
});
