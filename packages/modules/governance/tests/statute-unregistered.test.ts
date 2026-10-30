import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { completeRegisterFiling } from '../src/register/complete';
import { createRegisterFiling, getRegisterFiling } from '../src/register/filings';
import { openOccasionsInternal } from '../src/register/occasions-open';
import { createStatuteDraft, getStatute, registerStatute, updateStatute } from '../src/statutes';
import { RECORDING, setupGovernance, type GovernanceDeps } from './helpers';
import { statuteMeeting } from './register-helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const NOW = '2026-10-29T08:00:00.000Z';

async function resolved(deps: GovernanceDeps, ctx: Ctx, on: string, basedOnId: string, registeredOn?: string) {
  const id = unwrap(await createStatuteDraft(deps, ctx, { basedOnId })).id;
  unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on, resolutionId: null }] }));
  if (registeredOn) unwrap(await registerStatute(deps, ctx, { id, registeredOn }));
  return id;
}

/** Gründung eingetragen, ein Stand vom 15.06. beschlossen und nie eingetragen (W-1). */
async function withOpenStand(deps: GovernanceDeps, ctx: Ctx) {
  const founding = unwrap(await createStatuteDraft(deps, ctx, {})).id;
  unwrap(await updateStatute(deps, ctx, { id: founding, resolutions: [{ on: '2025-02-01', resolutionId: null }] }));
  unwrap(await registerStatute(deps, ctx, { id: founding, registeredOn: '2025-03-01' }));
  const open = await resolved(deps, ctx, '2026-06-15', founding);
  return { founding, open };
}

describe('W-1: a resolved, never registered stand', () => {
  it('becomes the base of a new draft without basedOnId, and the draft says so', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: NOW });
    const { open } = await withOpenStand(deps, ctx);
    const draft = unwrap(await createStatuteDraft(deps, ctx, {}));
    expect(draft.basedOnId).toBe(open);
    expect(draft.warnings).toContain('basedOnUnregistered');
  });

  it('stays resolved with its occasion open when a stand without its changes is registered, and that stand warns', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: NOW });
    const { founding, open } = await withOpenStand(deps, ctx);
    const other = await resolved(deps, ctx, '2026-10-20', founding);
    expect(unwrap(await getStatute(deps, ctx, { id: other })).warnings).toContain('omitsUnregistered');
    const registered = unwrap(await registerStatute(deps, ctx, { id: other, registeredOn: '2026-10-28' }));
    expect(registered).toMatchObject({ state: 'valid' });
    expect(registered.warnings).toContain('omitsUnregistered');
    expect(unwrap(await getStatute(deps, ctx, { id: open })).state).toBe('resolved');
    expect(openOccasionsInternal(deps.db, '2026-10-29').filter((o) => o.statuteId === open)).toHaveLength(1);
  });

  it('is superseded without warning when the registered stand builds on it', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: NOW });
    const { open } = await withOpenStand(deps, ctx);
    const next = await resolved(deps, ctx, '2026-10-20', open);
    const registered = unwrap(await registerStatute(deps, ctx, { id: next, registeredOn: '2026-10-28' }));
    expect(registered.warnings).not.toContain('omitsUnregistered');
    expect(unwrap(await getStatute(deps, ctx, { id: open })).state).toBe('superseded');
    expect(openOccasionsInternal(deps.db, '2026-10-29').filter((o) => o.statuteId === open)).toEqual([]);
  });

  it('the filing warns before and after completion', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const founding = await statuteMeeting(deps, ctx, '2025-02-01', { founding: true });
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: founding.occasionId }] })).id, registeredOn: '2025-03-01' }));
    const open = await statuteMeeting(deps, ctx, '2026-06-15', { basedOnId: founding.statuteId });
    const other = await statuteMeeting(deps, ctx, '2026-10-20', { basedOnId: founding.statuteId });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: other.occasionId }] }));
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).warnings).toContain('statuteOmitsUnregistered');
    const done = unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-10-28' }));
    expect(done.warnings).toContain('statuteOmitsUnregistered');
    expect(unwrap(await getStatute(deps, ctx, { id: open.statuteId })).state).toBe('resolved');
    expect(openOccasionsInternal(deps.db, '2026-10-29').some((o) => o.id === open.occasionId)).toBe(true);
  });
});

describe('K-3: a filed stand takes along the open occasion of the unregistered stand it builds on', () => {
  it('stored occasions: bundled automatically, done with the registration, the older stand stays unregistered', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const founding = await statuteMeeting(deps, ctx, '2025-02-01', { founding: true });
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: founding.occasionId }] })).id, registeredOn: '2025-03-01' }));
    const open = await statuteMeeting(deps, ctx, '2026-06-15', { basedOnId: founding.statuteId });
    const next = await statuteMeeting(deps, ctx, '2026-10-20', { basedOnId: open.statuteId });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: next.occasionId }] }));
    expect(filing.occasions.map((o) => o.id).sort()).toEqual([open.occasionId, next.occasionId].sort());
    const done = unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-10-28' }));
    expect(done.occasions.map((o) => o.statuteId).sort()).toEqual([open.statuteId, next.statuteId].sort());
    expect(openOccasionsInternal(deps.db, '2026-10-29').filter((o) => o.statuteId === open.statuteId)).toEqual([]);
    expect(unwrap(await getStatute(deps, ctx, { id: next.statuteId })).state).toBe('valid');
    expect(unwrap(await getStatute(deps, ctx, { id: open.statuteId }))).toMatchObject({ state: 'superseded', registeredOn: null });
  });

  it('computed occasions: the older stand is bundled as its own occasion', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const { open } = await withOpenStand(deps, ctx);
    const next = await resolved(deps, ctx, '2026-10-20', open);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ statuteId: next }] }));
    expect(filing.occasions.map((o) => o.statuteId).sort()).toEqual([open, next].sort());
    expect(openOccasionsInternal(deps.db, '2026-10-29').filter((o) => o.statuteId === open)).toEqual([]);
  });
});


describe('L-4: the tax review of a bundled stand carries over to the registered one', () => {
  it('affectsCharity and the submission move to the registered stand, so the § 60a notice request falls due', async () => {
    const { listGovernanceDeadlines } = await import('../src/deadlines/list');
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const founding = await statuteMeeting(deps, ctx, '2025-02-01', { founding: true });
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: founding.occasionId }] })).id, registeredOn: '2025-03-01' }));
    const open = await statuteMeeting(deps, ctx, '2026-06-15', { basedOnId: founding.statuteId });
    unwrap(await updateStatute(deps, ctx, { id: open.statuteId, taxReview: { affectsCharity: true, submittedOn: '2026-05-02', submissionDocumentId: null, answer: null, answerDocumentId: null } }));
    const next = await statuteMeeting(deps, ctx, '2026-10-20', { basedOnId: open.statuteId });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: next.occasionId }] }));
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-10-28' }));
    const registered = unwrap(await getStatute(deps, ctx, { id: next.statuteId }));
    expect(registered.taxReview).toMatchObject({ affectsCharity: true, submittedOn: '2026-05-02' });
    // Tag 1 nach der Eintragung: die Frist steht in der Liste, gewarnt wird erst nach ihrem Ablauf (0.5.0 Nr. 6).
    expect(registered.warnings).not.toContain('newNoticeMissing');
    expect(unwrap(await listGovernanceDeadlines(deps, ctx, {})).map((d) => d.key)).toContain(`taxNoticeRequest:${next.statuteId}`);
  });

  it.each(['newNotice', 'notRelevant'] as const)('a base the tax office has answered (%s) leaves the assessment of the registered stand alone', async (answer) => {
    const { listGovernanceDeadlines } = await import('../src/deadlines/list');
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const founding = await statuteMeeting(deps, ctx, '2025-02-01', { founding: true });
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: founding.occasionId }] })).id, registeredOn: '2025-03-01' }));
    const open = await statuteMeeting(deps, ctx, '2026-06-15', { basedOnId: founding.statuteId });
    unwrap(await updateStatute(deps, ctx, { id: open.statuteId, taxReview: { affectsCharity: true, submittedOn: null, submissionDocumentId: null, answer, answerDocumentId: null } }));
    const next = await statuteMeeting(deps, ctx, '2026-10-20', { basedOnId: open.statuteId });
    const assessed = { affectsCharity: false, submittedOn: '2026-10-21', submissionDocumentId: null, answer: 'notRelevant', answerDocumentId: null } as const;
    unwrap(await updateStatute(deps, ctx, { id: next.statuteId, taxReview: assessed }));
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: next.occasionId }] }));
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-10-28' }));
    expect(unwrap(await getStatute(deps, ctx, { id: next.statuteId })).taxReview).toEqual(assessed);
    expect(unwrap(await listGovernanceDeadlines(deps, ctx, {})).map((d) => d.key)).not.toContain(`taxNoticeRequest:${next.statuteId}`);
  });
});

describe('L-6: an automatically bundled occasion is reported', () => {
  it('create, add and complete name the occasions taken along; the filing stays overdue by the oldest and says why', async () => {
    const { addFilingOccasions } = await import('../src/register/filings');
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const founding = await statuteMeeting(deps, ctx, '2025-02-01', { founding: true });
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: founding.occasionId }] })).id, registeredOn: '2025-03-01' }));
    const open = await statuteMeeting(deps, ctx, '2026-06-15', { basedOnId: founding.statuteId });
    const next = await statuteMeeting(deps, ctx, '2026-10-20', { basedOnId: open.statuteId });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: next.occasionId }] }));
    expect(filing.attachedOccasions.map((o) => o.id)).toEqual([open.occasionId]);
    expect(filing).toMatchObject({ overdue: true });
    expect(filing.warnings).toContain('overdueByAttached');
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).warnings).toContain('overdueByAttached');
    const later = await statuteMeeting(deps, ctx, '2026-10-25', { basedOnId: founding.statuteId });
    expect(unwrap(await addFilingOccasions(deps, ctx, { filingId: filing.id, occasions: [{ id: later.occasionId }] })).attachedOccasions).toEqual([]);
    expect(unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-10-28' })).attachedOccasions).toEqual([]);
  });
});
