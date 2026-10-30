import { notifyRecordDeleted, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createCircular, decideCircular, getCircular, listCirculars, saveCircularResponse } from '../src/circulars';
import { governanceCircularResponses } from '../src/schema';
import { auditOf, GOVERNANCE_PERMISSIONS, holders, organOf, setupGovernance, withRules, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const base = { kind: 'simple', text: 'Der Vorstand beschafft einen Laptop für die Geschäftsstelle.', requestedOn: '2026-09-10', deadline: '2026-09-17', channel: 'email' };

async function boardCircular(rules?: Parameters<typeof withRules>[2]) {
  const { deps, ctx } = setupGovernance();
  if (rules) await withRules(deps, ctx, rules);
  const board = await holders(deps, ctx, ['chair', 'board', 'treasurer']);
  const circular = unwrap(await createCircular(deps, ctx, { organId: organOf(deps, 'board'), ...base }));
  return { deps, ctx, board, circular };
}
const answer = async (deps: GovernanceDeps, ctx: Ctx, circularId: string, answers: ('yes' | 'no' | 'abstain' | 'none')[]) => {
  const responses = unwrap(await getCircular(deps, ctx, { id: circularId })).responses;
  for (const [i, a] of answers.entries()) if (a !== 'none') unwrap(await saveCircularResponse(deps, ctx, { id: responses[i]!.id, answer: a, answeredOn: '2026-09-11' }));
  return unwrap(await getCircular(deps, ctx, { id: circularId }));
};

describe('circular resolutions', () => {
  it('Abnahme 8: under the law every board member must agree — a missing answer or an abstention fails it', async () => {
    const { deps, ctx, board, circular } = await boardCircular();
    expect(circular.responses.map((r) => r.contactId).sort()).toEqual([...board].sort());
    expect(circular.responses.every((r) => r.answer === 'none')).toBe(true);
    expect((await answer(deps, ctx, circular.id, ['yes', 'yes', 'none'])).evaluation).toMatchObject({ consent: 'all', reached: false, missing: 1 });
    expect((await answer(deps, ctx, circular.id, ['yes', 'yes', 'abstain'])).evaluation).toMatchObject({ reached: false, missing: 0 });
    expect((await answer(deps, ctx, circular.id, ['yes', 'yes', 'yes'])).evaluation).toMatchObject({ reached: true });
    expect(auditOf(deps, 'governance.circular.create')[0]!.params).toEqual({ kind: 'simple', organId: organOf(deps, 'board') });
    expect(JSON.stringify(auditOf(deps, 'governance.circular.create'))).not.toContain('Laptop');
  });

  it('with a majority in the statute two of three suffice', async () => {
    const { deps, ctx, circular } = await boardCircular({ board: { circular: { allowed: true, consent: { fraction: 'simple', base: 'all', abstentions: 'ignored' }, form: 'textForm' } } });
    expect((await answer(deps, ctx, circular.id, ['yes', 'yes', 'none'])).evaluation).toMatchObject({ reached: true });
  });

  it('adopted against the evaluation needs a reason; a messenger note without document is kept', async () => {
    const { deps, ctx, board, circular } = await boardCircular();
    const view = await answer(deps, ctx, circular.id, ['yes', 'yes', 'none']);
    const third = view.responses[2]!;
    expect(unwrap(await saveCircularResponse(deps, ctx, { id: third.id, answer: 'yes', answeredOn: '2026-09-12', note: 'Zustimmung per Messenger, Nachricht vom 12.09.' }))).toMatchObject({ evaluation: { reached: true } });
    expect(auditOf(deps, 'governance.circular.response').at(-1)!.params).toEqual({ answer: 'yes', contactId: third.contactId });
    unwrap(await saveCircularResponse(deps, ctx, { id: third.id, answer: 'no', answeredOn: '2026-09-12' }));
    const decide = { id: circular.id, outcome: 'adopted', decidedOn: '2026-09-18', decidedByContactId: board[0]! };
    expect(await decideCircular(deps, ctx, decide)).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ message: 'outcomeReasonRequired' }] } });
    expect(unwrap(await decideCircular(deps, ctx, { ...decide, outcome: 'rejected' }))).toMatchObject({ outcome: 'rejected', decidedOn: '2026-09-18', sealedAt: null });
    expect(auditOf(deps, 'governance.circular.decide')[0]!.params).toEqual({ kind: 'simple', outcome: 'rejected', againstCount: false });
  });

  it('warns when the statute does not allow circulars; validates and needs governance.manage', async () => {
    const { deps, ctx } = setupGovernance();
    await withRules(deps, ctx, { board: { circular: { allowed: false, consent: 'all', form: 'textForm' } } });
    const organId = organOf(deps, 'board');
    expect(unwrap(await createCircular(deps, ctx, { organId, ...base })).warnings).toEqual(['circularNotAllowed']);
    expect(await createCircular(deps, ctx, { organId, ...base, deadline: '2026-09-01' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await createCircular(deps, ctxWith(['governance.read', 'governance.record'], ctx.userId!), { organId, ...base })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(unwrap(await listCirculars(deps, ctxWith(['governance.read'], ctx.userId!), { organId }))).toHaveLength(1);
  });

  it('keeps the answer when the contact is deleted', async () => {
    const { deps, ctx, board } = await boardCircular();
    deps.db.transaction((tx) => notifyRecordDeleted(tx, deps, ctxWith(GOVERNANCE_PERMISSIONS, ctx.userId!), 'contact', board[0]!));
    expect(deps.db.select().from(governanceCircularResponses).all().filter((r) => r.contactId === null)).toHaveLength(1);
  });
});

describe('circular evaluation with numbers (U2)', () => {
  /** Ein Umlauf der Versammlung mit fünf stimmberechtigten Mitgliedern. */
  async function fiveMembers(consent?: 'majority') {
    const { member } = await import('./helpers');
    const { deps, ctx } = setupGovernance();
    if (consent) await withRules(deps, ctx, { assembly: { circular: { allowed: true, consent: { fraction: 'simple', base: 'all', abstentions: 'ignored' }, form: 'textForm' } } });
    for (let i = 0; i < 5; i++) await member(deps);
    const circular = unwrap(await createCircular(deps, ctx, { organId: organOf(deps, 'assembly'), ...base }));
    return { deps, ctx, circular };
  }
  const answerOn = async (deps: GovernanceDeps, ctx: Ctx, circularId: string, answers: [('yes' | 'no' | 'abstain' | 'none'), string][]) => {
    const responses = unwrap(await getCircular(deps, ctx, { id: circularId })).responses;
    for (const [i, [a, on]] of answers.entries()) if (a !== 'none') unwrap(await saveCircularResponse(deps, ctx, { id: responses[i]!.id, answer: a, answeredOn: on }));
    return unwrap(await getCircular(deps, ctx, { id: circularId })).evaluation;
  };

  it('consent of all with five rows: two yes and one no can no longer pass', async () => {
    const { deps, ctx, circular } = await fiveMembers();
    const e = await answerOn(deps, ctx, circular.id, [['yes', '2026-09-11'], ['yes', '2026-09-11'], ['no', '2026-09-12'], ['none', ''], ['none', '']]);
    expect(e).toMatchObject({ needed: 5, yes: 2, no: 1, abstain: 0, total: 5, possible: false, reached: false, reachedOn: null });
  });

  it('more than half of five: needs three; with two open still possible; the third yes sets the day', async () => {
    const { deps, ctx, circular } = await fiveMembers('majority');
    const open = await answerOn(deps, ctx, circular.id, [['yes', '2026-09-11'], ['yes', '2026-09-13'], ['no', '2026-09-12'], ['none', ''], ['none', '']]);
    expect(open).toMatchObject({ needed: 3, yes: 2, no: 1, total: 5, possible: true, reached: false });
    const done = await answerOn(deps, ctx, circular.id, [['yes', '2026-09-11'], ['yes', '2026-09-13'], ['no', '2026-09-12'], ['yes', '2026-09-14'], ['none', '']]);
    expect(done).toMatchObject({ needed: 3, yes: 3, reached: true, reachedOn: '2026-09-14' });
  });
});

describe('dates of the answers (G-18)', () => {
  it('an answer after the deadline warns answerAfterDeadline; an answer before the request is refused', async () => {
    const { deps, ctx, circular } = await boardCircular();
    const [r0, r1] = circular.responses;
    unwrap(await saveCircularResponse(deps, ctx, { id: r0!.id, answer: 'yes', answeredOn: '2026-09-11' }));
    expect(unwrap(await getCircular(deps, ctx, { id: circular.id })).warnings).not.toContain('answerAfterDeadline');
    expect(unwrap(await saveCircularResponse(deps, ctx, { id: r1!.id, answer: 'yes', answeredOn: '2026-09-18' })).warnings).toContain('answerAfterDeadline');
    expect(await saveCircularResponse(deps, ctx, { id: r1!.id, answer: 'yes', answeredOn: '2026-09-09' })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'answeredOn', message: 'beforeRequest' }] } });
  });
});

describe('K-5: circulars warn about missing details like meeting resolutions', () => {
  it('accounts and dismissal without details carry detailsMissing; a simple circular does not', async () => {
    const { deps, ctx } = setupGovernance();
    await holders(deps, ctx, ['chair', 'board', 'treasurer']);
    for (const kind of ['accounts', 'dismissal'] as const) {
      const c = unwrap(await createCircular(deps, ctx, { organId: organOf(deps, 'board'), ...base, kind }));
      expect(c.warnings).toContain('detailsMissing');
      expect(unwrap(await getCircular(deps, ctx, { id: c.id })).warnings).toContain('detailsMissing');
    }
    expect(unwrap(await createCircular(deps, ctx, { organId: organOf(deps, 'board'), ...base })).warnings).not.toContain('detailsMissing');
  });
});

describe('L-1: remuneration decided by the wrong organ, beneficiaries answering', () => {
  it('a board circular paying the treasurer warns remunerationWrongOrgan when the statute says the assembly decides, and excludedAnswered once the treasurer answers', async () => {
    const { deps, ctx } = setupGovernance();
    const board = organOf(deps, 'board');
    const assembly = organOf(deps, 'assembly');
    await withRules(deps, ctx, { board: { remuneration: { statuteReference: '§ 7 Abs. 5', decidedBy: assembly }, circular: { allowed: true, consent: 'all', form: 'textForm' } } });
    const [, , treasurer] = await holders(deps, ctx, ['chair', 'board', 'treasurer']);
    const { officeOf } = await import('./helpers');
    const details = { statuteReference: '§ 7 Abs. 5', decidedByOrganId: board, officeIds: [officeOf(deps, 'treasurer')], mode: 'flat', amountCents: 50000, validFrom: '2026-11-01' };
    const c = unwrap(await createCircular(deps, ctx, { organId: board, ...base, kind: 'remuneration', details }));
    expect(c.warnings).toContain('remunerationWrongOrgan');
    expect(c.warnings).not.toContain('remunerationWithoutStatute');
    expect(c.warnings).not.toContain('excludedAnswered');
    const row = c.responses.find((r) => r.contactId === treasurer)!;
    expect(unwrap(await saveCircularResponse(deps, ctx, { id: row.id, answer: 'yes', answeredOn: '2026-09-11' })).warnings).toContain('excludedAnswered');
  });
});
