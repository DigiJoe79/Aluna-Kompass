import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { lastDayBefore, noticeDeadlineInternal } from '../src/deadlines/notice';
import { organRulesSchema } from '../src/rules/schema';
import { governanceOrgans } from '../src/schema';
import { createStatuteDraft, registerStatute, updateStatute } from '../src/statutes';
import { setupGovernance, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;

async function stand(deps: GovernanceDeps, ctx: Ctx, organId: string, rules: Record<string, unknown>, resolvedOn: string, registeredOn?: string) {
  const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
  unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: resolvedOn, resolutionId: null }], rules: { organs: { [organId]: rules } } }));
  if (registeredOn) unwrap(await registerStatute(deps, ctx, { id, registeredOn }));
  return id;
}

describe('lastDayBefore', () => {
  it('leaves full days between receipt and meeting (§§ 187, 188 BGB backwards), no weekend shift', () => {
    expect(lastDayBefore('2026-09-05', 14)).toBe('2026-08-21');
    expect(lastDayBefore('2026-03-01', 0)).toBe('2026-02-28');
  });
});

describe('noticeDeadlineInternal', () => {
  it('Review Focus 1: 14 days from receipt, transit mail 1 and post 3, motions 7 days', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = organ(deps, 'assembly');
    const statuteId = await stand(deps, ctx, mv, { noticeDays: 14, noticeStrictness: 'must', noticeFrom: 'received', transitDays: { email: 1, post: 3 }, motionDeadlineDays: 7 }, '2026-07-20');
    expect(noticeDeadlineInternal(deps.db, mv, '2026-09-05')).toEqual({
      statuteId,
      noticeDays: 14,
      strictness: 'must',
      from: 'received',
      lastReceiptDay: '2026-08-21',
      sendBy: { email: '2026-08-20', post: '2026-08-18' },
      motionsBy: '2026-08-28',
      lawHintDay: '2026-08-21',
      source: 'statute',
    });
  });

  it('Review Focus 2: the rules of the meeting day, not of today', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2027-02-01T08:00:00.000Z' });
    const mv = organ(deps, 'assembly');
    await stand(deps, ctx, mv, { noticeDays: 14 }, '2027-01-05', '2027-01-10');
    const b = await stand(deps, ctx, mv, { noticeDays: 21 }, '2027-01-20', '2027-03-01');
    const deadline = noticeDeadlineInternal(deps.db, mv, '2027-03-20');
    expect(deadline).toMatchObject({ statuteId: b, noticeDays: 21, lastReceiptDay: '2027-02-26' });
    expect(noticeDeadlineInternal(deps.db, mv, '2027-02-20').noticeDays).toBe(14);
  });

  it('falls back to the law without a statute: no deadline, a hint 14 days before', () => {
    const { deps } = setupGovernance();
    expect(noticeDeadlineInternal(deps.db, organ(deps, 'assembly'), '2026-09-05')).toMatchObject({
      statuteId: null,
      noticeDays: null,
      strictness: null,
      lastReceiptDay: null,
      sendBy: { email: null, post: null },
      motionsBy: null,
      lawHintDay: '2026-08-21',
      source: 'law',
      norm: 'Rechtsprechung (angemessene Frist)',
    });
  });

  it('counts from sending when the statute says so', async () => {
    const { deps, ctx } = setupGovernance();
    const board = organ(deps, 'board');
    await stand(deps, ctx, board, { noticeDays: 7, noticeFrom: 'sent' }, '2026-07-20');
    expect(noticeDeadlineInternal(deps.db, board, '2026-09-05')).toMatchObject({ lastReceiptDay: '2026-08-28', sendBy: { email: '2026-08-28', post: '2026-08-28' }, from: 'sent' });
  });

  it('knows the optional rule ordinaryMeetingYearly', () => {
    expect(organRulesSchema.safeParse({ ordinaryMeetingYearly: true }).success).toBe(true);
  });
});
