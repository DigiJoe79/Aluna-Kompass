import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { presentAtInternal, recordDeparture, saveAttendance } from '../src/attendance';
import { presentFromRows, quorumPresent } from '../src/live';
import { quorumInternal } from '../src/quorum';
import { governanceAttendance } from '../src/schema';
import { RECORDING, session, setupGovernance, withRules } from './helpers';

type Row = Parameters<typeof presentFromRows>[0][number];
const row = (over: Partial<Row>): Row => ({ contactId: 'c', guest: false, role: 'member', votingRight: true, periods: [], ...over });

describe('presentFromRows (browser)', () => {
  it('counts an arrival from its minute and a departure no longer', () => {
    const rows = [row({ contactId: 'a', periods: [{ from: '19:00', to: '20:41' }] })];
    expect(presentFromRows(rows, '19:00').voting).toBe(1);
    expect(presentFromRows(rows, '20:40').voting).toBe(1);
    expect(presentFromRows(rows, '20:41').voting).toBe(0);
    expect(presentFromRows(rows, '18:59').persons).toBe(0);
  });

  it('a guest is a person, never a voter or a member', () => {
    const rows = [row({ contactId: null, guest: true, role: 'guest', votingRight: false, periods: [{ from: '19:00', to: null }] })];
    expect(presentFromRows(rows, '19:30')).toMatchObject({ persons: 1, members: 0, voting: 0, organMembers: 0, contactIds: [] });
  });
});

describe('Gegenprobe against the service', () => {
  it('equals presentAtInternal and the quorum count for three bases', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, attendance } = await session(deps, ctx, { items: ['simple'], voters: 4 });
    unwrap(await saveAttendance(deps, ctx, { meetingId: meeting.id, role: 'guest', guestLabel: 'Gast' }));
    unwrap(await recordDeparture(deps, ctx, { attendanceId: attendance[0]!.id, at: '19:30' }));
    const rows = () => deps.db.select().from(governanceAttendance).all();
    for (const at of ['19:00', '19:29', '19:30', '20:00']) expect(presentFromRows(rows(), at)).toEqual(presentAtInternal(deps.db, meeting.id, at));

    const assembly = { allMembers: { kind: 'fraction', fraction: { num: 1, den: 4 }, base: 'allMembers' }, votingMembers: { kind: 'fraction', fraction: { num: 1, den: 2 }, base: 'votingMembers' }, absolute: { kind: 'absolute', count: 3 } } as const;
    for (const [basis, quorum] of Object.entries(assembly)) {
      const { deps: d, ctx: c } = setupGovernance(RECORDING);
      await withRules(d, c, { assembly: { quorum } });
      const s = await session(d, c, { items: ['simple'], voters: 4 });
      unwrap(await recordDeparture(d, c, { attendanceId: s.attendance[1]!.id, at: '19:15' }));
      const at = '19:20';
      const q = quorumInternal(d.db, d, s.meeting.id, at);
      expect(q.basis).toBe(basis);
      expect(quorumPresent(presentFromRows(d.db.select().from(governanceAttendance).all(), at), q.basis, true)).toBe(q.present);
    }
  });
});
