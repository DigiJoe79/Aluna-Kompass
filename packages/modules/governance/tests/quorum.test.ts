import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { prefillAttendance, recordArrival } from '../src/attendance';
import { createMeeting } from '../src/meetings';
import { quorumInternal } from '../src/quorum';
import { startMeeting } from '../src/session';
import { holders, member, organOf, RECORDING, runningMeeting, setupGovernance, withRules, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];

/** `present` der Vorbelegten kommen um 19:00. */
async function arrive(deps: GovernanceDeps, ctx: Ctx, meetingId: string, present: number) {
  const rows = unwrap(await prefillAttendance(deps, ctx, { meetingId }));
  for (const row of rows.slice(0, present)) unwrap(await recordArrival(deps, ctx, { attendanceId: row.id, at: '19:00' }));
}

async function assemblyOfTwenty(present: number, members = 20, comparison?: 'atLeast' | 'moreThan') {
  const { deps, ctx } = setupGovernance(RECORDING);
  await withRules(deps, ctx, { assembly: { quorum: { kind: 'fraction', fraction: { num: 1, den: 3 }, base: 'allMembers', ...(comparison ? { comparison } : {}) } } });
  for (let i = 0; i < members; i++) await member(deps, { type: i < 5 ? 'supporting' : 'regular' });
  const meeting = await runningMeeting(deps, ctx, 'ordinary');
  await arrive(deps, ctx, meeting.id, present);
  return quorumInternal(deps.db, deps, meeting.id, '19:30');
}

describe('quorumInternal', () => {
  it('a third of all members: 20 members, 7 present is quorate, 6 is not', async () => {
    expect(await assemblyOfTwenty(7)).toMatchObject({ required: 7, present: 7, met: true, source: 'statute', basis: 'allMembers' });
    expect(await assemblyOfTwenty(6)).toMatchObject({ required: 7, present: 6, met: false });
  });

  it('more than a third of 30 members needs 11, at least a third needs 10', async () => {
    expect(await assemblyOfTwenty(10, 30, 'moreThan')).toMatchObject({ required: 11, met: false });
    expect(await assemblyOfTwenty(10, 30, 'atLeast')).toMatchObject({ required: 10, met: true });
  });

  it('a repeat meeting without quorum has none', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { quorum: { kind: 'fraction', fraction: { num: 1, den: 3 }, base: 'allMembers' }, repeatMeeting: { withinDays: 28, noQuorum: true } } });
    const mv = organOf(deps, 'assembly');
    const first = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-08-01', startsAt: '19:00', form: 'inPerson' }));
    const repeat = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'repeat', repeatOfId: first.id, heldOn: '2026-08-20', startsAt: '19:00', form: 'inPerson' }));
    unwrap(await startMeeting(deps, ctx, { meetingId: repeat.id }));
    expect(quorumInternal(deps.db, deps, repeat.id, '19:30')).toMatchObject({ required: null, met: null, basis: 'none', source: 'statute' });
  });

  it('a board with an absolute quorum of two', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { board: { quorum: { kind: 'absolute', count: 2 } } });
    await holders(deps, ctx, ['chair', 'board', 'treasurer']);
    const meeting = await runningMeeting(deps, ctx, 'board');
    await arrive(deps, ctx, meeting.id, 2);
    expect(quorumInternal(deps.db, deps, meeting.id, '19:30')).toMatchObject({ required: 2, present: 2, met: true, basis: 'absolute' });
  });

  it('without statute the law knows no quorum', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await member(deps);
    const meeting = await runningMeeting(deps, ctx, 'ordinary');
    await arrive(deps, ctx, meeting.id, 1);
    expect(quorumInternal(deps.db, deps, meeting.id, '19:30')).toMatchObject({ required: null, present: 1, met: null, source: 'law', basis: 'none' });
    expect(quorumInternal(deps.db, deps, meeting.id, '19:30').norm).toMatch(/BGB/);
  });
});
