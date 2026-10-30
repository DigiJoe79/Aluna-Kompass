import { notifyRecordDeleted, unwrap, type CallContext } from '@kompass/core';
import { ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { endMembership } from '@kompass/module-members';
import { describe, expect, it } from 'vitest';
import { prefillAttendance, presentAtInternal, recordArrival, recordDeparture, saveAttendance } from '../src/attendance';
import { governanceAttendance } from '../src/schema';
import { auditOf, holders, member, person, RECORDING, runningMeeting, setupGovernance } from './helpers';

const membersCtx: CallContext = { ...systemContext(), permissions: new Set(['members.manage']) };

describe('prefillAttendance', () => {
  it('assembly: every running membership with its voting right, absent; an ended one is missing', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const regular = await member(deps, { type: 'regular' });
    const supporting = await member(deps, { type: 'supporting' });
    const gone = await member(deps);
    unwrap(await endMembership(deps, membersCtx, { membershipId: gone.membershipId, endsOn: '2026-08-31', reason: 'other' }));
    const meeting = await runningMeeting(deps, ctx, 'ordinary');
    const rows = unwrap(await prefillAttendance(deps, ctx, { meetingId: meeting.id }));
    expect(rows.map((r) => [r.contactId, r.role, r.votingRight, r.periods]).sort()).toEqual(
      [
        [regular.contactId, 'member', true, []],
        [supporting.contactId, 'member', false, []],
      ].sort(),
    );
    expect(rows.find((r) => r.contactId === regular.contactId)!.membershipId).toBe(regular.membershipId);
    expect(auditOf(deps, 'governance.attendance.prefill')[0]!.params).toEqual({ count: 2 });
    expect(await prefillAttendance(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'attendanceNotEmpty' } });
  });

  it('board: the three office holders, each with a vote', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const ids = await holders(deps, ctx, ['chair', 'board', 'treasurer']);
    const meeting = await runningMeeting(deps, ctx, 'board');
    const rows = unwrap(await prefillAttendance(deps, ctx, { meetingId: meeting.id }));
    expect(rows.map((r) => r.contactId).sort()).toEqual([...ids].sort());
    expect(rows.every((r) => r.role === 'officeHolder' && r.votingRight)).toBe(true);
  });
});

describe('arrival and departure', () => {
  it('Review Focus 1: late arrival, early departure — present only in between', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { contactId } = await member(deps);
    const meeting = await runningMeeting(deps, ctx, 'ordinary');
    const [row] = unwrap(await prefillAttendance(deps, ctx, { meetingId: meeting.id }));
    unwrap(await recordArrival(deps, ctx, { attendanceId: row!.id, at: '19:40' }));
    unwrap(await recordDeparture(deps, ctx, { attendanceId: row!.id, at: '20:30' }));
    expect(presentAtInternal(deps.db, meeting.id, '19:20')).toMatchObject({ voting: 0, members: 0 });
    expect(presentAtInternal(deps.db, meeting.id, '19:45')).toMatchObject({ persons: 1, members: 1, voting: 1, votingContactIds: [contactId] });
    expect(presentAtInternal(deps.db, meeting.id, '20:30').voting).toBe(0);
    expect(presentAtInternal(deps.db, meeting.id, '20:40').voting).toBe(0);
    expect(auditOf(deps, 'governance.attendance.arrive')[0]!.params).toEqual({ at: '19:40', contactId });
    expect(auditOf(deps, 'governance.attendance.leave')[0]!.params).toEqual({ at: '20:30', contactId });
  });

  it('a guest counts only as a person; leaving without arriving and leaving before arriving are refused', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = await runningMeeting(deps, ctx, 'ordinary');
    const guest = unwrap(await saveAttendance(deps, ctx, { meetingId: meeting.id, role: 'guest', guestLabel: 'Gast (Steuerberatung)' }));
    expect(guest).toMatchObject({ guest: true, votingRight: false, contactId: null });
    expect(await recordDeparture(deps, ctx, { attendanceId: guest.id, at: '19:30' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    unwrap(await recordArrival(deps, ctx, { attendanceId: guest.id, at: '19:00' }));
    expect(await recordArrival(deps, ctx, { attendanceId: guest.id, at: '19:05' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await recordDeparture(deps, ctx, { attendanceId: guest.id, at: '18:59' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(presentAtInternal(deps.db, meeting.id, '19:30')).toMatchObject({ persons: 1, members: 0, voting: 0, organMembers: 0, contactIds: [] });
    expect(auditOf(deps, 'governance.attendance.save')[0]!.params).toEqual({ role: 'guest', contactId: null });
    expect(JSON.stringify(auditOf(deps, 'governance.attendance.save'))).not.toContain('Steuerberatung');
  });

  it('a founder is added by hand with a vote; a person without contact is refused', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = await runningMeeting(deps, ctx, 'founding');
    expect(unwrap(await prefillAttendance(deps, ctx, { meetingId: meeting.id }))).toEqual([]);
    const contactId = await person(deps, 'Gründerin');
    expect(unwrap(await saveAttendance(deps, ctx, { meetingId: meeting.id, role: 'founder', contactId }))).toMatchObject({ votingRight: true, guest: false });
    expect(await saveAttendance(deps, ctx, { meetingId: meeting.id, role: 'founder' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('only the writer records; without governance.record it is forbidden', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await member(deps);
    const meeting = await runningMeeting(deps, ctx, 'ordinary');
    const other = ctxWith(RECORDING, insertUser(deps, { name: 'Zweite', email: 'zweite@kompass.local' }));
    expect(await prefillAttendance(deps, other, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'notWriter' } });
    const reader = ctxWith(['governance.read'], ctx.userId!);
    expect(await prefillAttendance(deps, reader, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('keeps the row and its voting right when the contact is deleted', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = await runningMeeting(deps, ctx, 'board');
    const contactId = await person(deps, 'Weg');
    const row = unwrap(await saveAttendance(deps, ctx, { meetingId: meeting.id, role: 'officeHolder', contactId }));
    unwrap(await recordArrival(deps, ctx, { attendanceId: row.id, at: '19:00' }));
    deps.db.transaction((tx) => notifyRecordDeleted(tx, deps, ctx, 'contact', contactId));
    expect(deps.db.select().from(governanceAttendance).all()).toMatchObject([{ id: row.id, contactId: null, votingRight: true, periods: [{ from: '19:00', to: null }] }]);
    expect(presentAtInternal(deps.db, meeting.id, '19:30')).toMatchObject({ voting: 1, organMembers: 1 });
  });
});
