import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { governanceOffices, governanceOrgans } from '../src/schema';
import { createStatuteDraft, deleteStatuteDraft, getStatute, listStatutes, registerStatute, statuteRulesOn, statuteValidOnInternal, updateStatute } from '../src/statutes';
import { startTerm } from '../src/terms';
import { asMcp, auditOf, person, setupGovernance, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];

/** Ein Stand mit Beschlüssen (und Eintragung), über die Dienste. */
async function statute(deps: GovernanceDeps, ctx: Ctx, resolvedOn: string[], registeredOn?: string, basedOnId?: string) {
  const draft = unwrap(await createStatuteDraft(deps, ctx, basedOnId ? { basedOnId } : {}));
  unwrap(await updateStatute(deps, ctx, { id: draft.id, resolutions: resolvedOn.map((on) => ({ on, resolutionId: null })) }));
  if (registeredOn) unwrap(await registerStatute(deps, ctx, { id: draft.id, registeredOn }));
  return draft.id;
}

/** Gründung 20.07., Änderung 05.09. als zweiter Stand, mit der Ersteintragung am 17.09. eingetragen. */
async function foundingSequence(deps: GovernanceDeps, ctx: Ctx) {
  const founding = await statute(deps, ctx, ['2026-07-20']);
  const second = await statute(deps, ctx, ['2026-09-05'], '2026-09-17', founding);
  return { founding, second };
}

describe('statuteValidOnInternal (Review Focus 1)', () => {
  it('takes the latest resolved stand before the first registration and only registered ones after it', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    const { founding, second } = await foundingSequence(deps, ctx);
    expect(statuteValidOnInternal(deps.db, '2026-08-01')?.id).toBe(founding);
    expect(statuteValidOnInternal(deps.db, '2026-09-05')?.id).toBe(founding); // die beschließende Versammlung gilt nach alter Fassung
    expect(statuteValidOnInternal(deps.db, '2026-09-10')?.id).toBe(second);
    expect(statuteValidOnInternal(deps.db, '2026-09-20')?.id).toBe(second);
    expect(statuteValidOnInternal(deps.db, '2026-07-20')).toBeNull();
    const third = await statute(deps, ctx, ['2027-05-01'], undefined, second);
    expect(statuteValidOnInternal(deps.db, '2027-06-01')?.id).toBe(second);
    expect(unwrap(await getStatute(deps, ctx, { id: third })).state).toBe('resolved');
  });
});

describe('statute states', () => {
  it('computes draft, resolved, valid and superseded for today', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    const draft = unwrap(await createStatuteDraft(deps, ctx, {}));
    expect(draft.state).toBe('draft');
    const { founding, second } = await foundingSequence(deps, ctx);
    const states = new Map(unwrap(await listStatutes(deps, ctx, {})).map((s) => [s.id, s.state]));
    expect(states.get(founding)).toBe('superseded');
    expect(states.get(second)).toBe('valid');
    expect(states.get(draft.id)).toBe('draft');
    const view = unwrap(await getStatute(deps, ctx, { id: second }));
    expect(view.lastResolvedOn).toBe('2026-09-05');
    expect(view.warnings).toContain('taxReviewOpen');
    unwrap(await updateStatute(deps, ctx, { id: second, taxReview: { affectsCharity: true, submittedOn: null, submissionDocumentId: null, answer: null, answerDocumentId: null } }));
    // Eingetragen am 17.09., heute Tag 14: die Frist für den neuen Bescheid läuft noch, keine Warnung (0.5.0 Nr. 6).
    expect(unwrap(await getStatute(deps, ctx, { id: second })).warnings).toEqual([]);
  });

  it('marks a freshly resolved stand as resolved', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-08-01T08:00:00.000Z' });
    const id = await statute(deps, ctx, ['2026-07-20']);
    // Vor der Ersteintragung gilt er ab dem Tag nach dem Beschluss.
    expect(unwrap(await getStatute(deps, ctx, { id })).state).toBe('valid');
    const { deps: d2, ctx: c2 } = setupGovernance(undefined, { now: '2026-07-20T08:00:00.000Z' });
    const id2 = await statute(d2, c2, ['2026-07-20']);
    expect(unwrap(await getStatute(d2, c2, { id: id2 })).state).toBe('resolved');
  });
});

describe('statute services', () => {
  it('copies the rules of the base into a draft and audits create and update', async () => {
    const { deps, ctx } = setupGovernance();
    const board = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'board')!;
    const base = unwrap(await createStatuteDraft(deps, ctx, {}));
    unwrap(await updateStatute(deps, ctx, { id: base.id, rules: { organs: { [board.id]: { tie: 'chairDecides' } } }, note: 'Erste Fassung' }));
    const copy = unwrap(await createStatuteDraft(deps, ctx, { basedOnId: base.id }));
    expect(copy).toMatchObject({ basedOnId: base.id, rules: { organs: { [board.id]: { tie: 'chairDecides' } } }, state: 'draft' });
    expect(auditOf(deps, 'governance.statute.create')).toHaveLength(2);
    expect(auditOf(deps, 'governance.statute.update').map((e) => e.params)).toEqual([{ fields: 'rules, note' }]);
  });

  it('refuses invalid rules and a missing permission', async () => {
    const { deps, ctx } = setupGovernance();
    const draft = unwrap(await createStatuteDraft(deps, ctx, {}));
    expect(await updateStatute(deps, ctx, { id: draft.id, rules: { organs: { x: { minorityRequest: { num: 2, den: 1 } } } } })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const reader = setupGovernance(['governance.read']);
    expect(await createStatuteDraft(reader.deps, reader.ctx, {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('registers only a resolved stand, not before its resolution, and only at the screen', async () => {
    const { deps, ctx } = setupGovernance();
    const draft = unwrap(await createStatuteDraft(deps, ctx, {}));
    expect(await registerStatute(deps, ctx, { id: draft.id, registeredOn: '2026-09-17' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statuteNotResolved' } });
    unwrap(await updateStatute(deps, ctx, { id: draft.id, resolutions: [{ on: '2026-09-05', resolutionId: null }] }));
    expect(await registerStatute(deps, ctx, { id: draft.id, registeredOn: '2026-09-01' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await registerStatute(deps, asMcp(ctx), { id: draft.id, registeredOn: '2026-09-17' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    expect(await registerStatute(deps, ctx, { id: draft.id, registeredOn: '2026-09-17' })).toMatchObject({ ok: true, value: { registeredOn: '2026-09-17' } });
    expect(auditOf(deps, 'governance.statute.register').map((e) => e.params)).toEqual([{ registeredOn: '2026-09-17' }]);
  });

  it('deletes a draft, but not a resolved stand', async () => {
    const { deps, ctx } = setupGovernance();
    const draft = unwrap(await createStatuteDraft(deps, ctx, {}));
    expect(await deleteStatuteDraft(deps, ctx, { id: draft.id })).toMatchObject({ ok: true });
    expect(auditOf(deps, 'governance.statute.delete')).toHaveLength(1);
    const resolved = await statute(deps, ctx, ['2026-07-20']);
    expect(await deleteStatuteDraft(deps, ctx, { id: resolved })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statuteNotDraft' } });
  });

  it('returns the rules valid on a day, empty without a stand', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    expect(unwrap(await statuteRulesOn(deps, ctx, { on: '2026-08-01' }))).toEqual({ statuteId: null, rules: { organs: {} } });
    const { second } = await foundingSequence(deps, ctx);
    expect(unwrap(await statuteRulesOn(deps, ctx, { on: '2026-09-20' })).statuteId).toBe(second);
  });

  it('stores the representation rule of the board with its reference and returns it with the rules', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    const board = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'board')!.id;
    const id = await statute(deps, ctx, ['2026-07-20']);
    unwrap(await updateStatute(deps, ctx, { id, rules: { organs: { [board]: { representation: { mode: 'single' } } }, references: { [board]: { representation: '§ 9 Satzung' } } } }));
    const { rules } = unwrap(await statuteRulesOn(deps, ctx, { on: '2026-08-01' }));
    expect(rules.organs[board]!.representation).toEqual({ mode: 'single' });
    expect(rules.references![board]!.representation).toBe('§ 9 Satzung');
  });
});

describe('substitute appointment and the statute (Task 4)', () => {
  it('warns without substitutionAllowed in the valid stand and not with it', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    const board = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'board')!;
    const chair = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    const deputy = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'board')!;
    const without = unwrap(await startTerm(deps, ctx, { officeId: chair.id, contactId: await person(deps, 'Eins'), since: '2026-08-01', origin: 'substitute' }));
    expect(without.warnings).toContain('substitutionWithoutStatute');
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-07-20', resolutionId: null }], rules: { organs: { [board.id]: { substitutionAllowed: true } } } }));
    const withRule = unwrap(await startTerm(deps, ctx, { officeId: deputy.id, contactId: await person(deps, 'Zwei'), since: '2026-08-01', origin: 'substitute' }));
    expect(withRule.warnings).toEqual([]);
  });
});

describe('updateStatute — resolutions by hand (G-4)', () => {
  it('takes only statute or purpose resolutions of the assembly, never drops a linked one, never touches a registered stand', async () => {
    const { RECORDING, adopt, session } = await import('./helpers');
    const { deps, ctx } = setupGovernance(RECORDING, { now: '2026-10-01T08:00:00.000Z' });
    const draft = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    const board = await session(deps, ctx, { kind: 'board', items: ['simple'] });
    const simple = await adopt(deps, ctx, board.items[0]!.id);
    expect(await updateStatute(deps, ctx, { id: draft, resolutions: [{ on: '2026-09-05', resolutionId: simple.id }] })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'resolutions', message: 'notStatuteResolution' }] } });

    const assembly = await session(deps, ctx, { items: ['statute'], voters: 3 });
    const statuteResolution = await adopt(deps, ctx, assembly.items[0]!.id, { details: { statuteId: draft } });
    unwrap(await updateStatute(deps, ctx, { id: draft, resolutions: [{ on: '2026-09-05', resolutionId: statuteResolution.id }] }));
    expect(await updateStatute(deps, ctx, { id: draft, resolutions: [] })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'resolutions', message: 'linkedResolutionKept' }] } });

    const registered = await statute(deps, ctx, ['2026-01-10'], '2026-02-01');
    expect(await updateStatute(deps, ctx, { id: registered, resolutions: [] })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'resolutions', message: 'statuteRegistered' }] } });
  });
});

describe('createStatuteDraft without base (G-16)', () => {
  it('copies the rules of the stand valid today; basedOnId null starts empty', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    const organId = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'assembly')!.id;
    const valid = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id: valid, resolutions: [{ on: '2024-03-01', resolutionId: null }], rules: { organs: { [organId]: { noticeDays: 14 } } } }));
    unwrap(await registerStatute(deps, ctx, { id: valid, registeredOn: '2024-05-01' }));
    const draft = unwrap(await createStatuteDraft(deps, ctx, {}));
    expect(draft).toMatchObject({ basedOnId: valid, rules: { organs: { [organId]: { noticeDays: 14 } } } });
    expect(unwrap(await createStatuteDraft(deps, ctx, { basedOnId: null }))).toMatchObject({ basedOnId: null, rules: { organs: {} } });
  });
});

describe('tax review of a stand (G-31)', () => {
  it('taxReviewOpen also while the tax office has not answered a stand that affects charity', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    const id = await statute(deps, ctx, ['2026-06-15']);
    const review = { affectsCharity: true, submittedOn: '2026-05-02', submissionDocumentId: null, answer: null, answerDocumentId: null };
    expect(unwrap(await updateStatute(deps, ctx, { id, taxReview: review })).warnings).toContain('taxReviewOpen');
    expect(unwrap(await updateStatute(deps, ctx, { id, taxReview: { ...review, answer: 'notRelevant' } })).warnings).not.toContain('taxReviewOpen');
    expect(unwrap(await updateStatute(deps, ctx, { id, taxReview: { ...review, affectsCharity: false } })).warnings).not.toContain('taxReviewOpen');
  });
});

describe('K-7: a stand registered on the day it was resolved', () => {
  it('judges that day by the previous stand; it is valid from that day, its rules count from the next', async () => {
    const { deps, ctx } = setupGovernance();
    const old = await statute(deps, ctx, ['2025-02-01'], '2025-03-01');
    const fresh = await statute(deps, ctx, ['2026-03-14'], '2026-03-14', old);
    expect(statuteValidOnInternal(deps.db, '2026-03-14')!.id).toBe(fresh);
    expect(unwrap(await statuteRulesOn(deps, ctx, { on: '2026-03-14' })).statuteId).toBe(old);
    expect(unwrap(await statuteRulesOn(deps, ctx, { on: '2026-03-15' })).statuteId).toBe(fresh);
  });
});
