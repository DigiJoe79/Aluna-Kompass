import { schema, unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { cancelMeeting, createMeeting, meetingStateOf } from '../src/meetings';
import { governanceOrgans } from '../src/schema';
import { endMeeting, reopenMeeting, requireWriterInternal, startMeeting, takeOverMinutes } from '../src/session';
import { meetingRowInternal } from '../src/meetings';
import { auditOf, RECORDING, setupGovernance, type GovernanceDeps } from './helpers';

const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;
const head = { heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' as const };

async function boardMeeting() {
  const setup = setupGovernance(RECORDING);
  const meeting = unwrap(await createMeeting(setup.deps, setup.ctx, { organId: organ(setup.deps, 'board'), kind: 'board', ...head }));
  return { ...setup, meeting };
}

describe('meeting session', () => {
  it('computes running and recorded from the stamps', () => {
    const row = { cancelledOn: null, invitedOn: '2026-09-01', startedAt: null, endedAt: null } as Parameters<typeof meetingStateOf>[0];
    expect(meetingStateOf({ ...row, startedAt: '2026-09-05T17:00:00.000Z' })).toBe('running');
    expect(meetingStateOf({ ...row, startedAt: '2026-09-05T17:00:00.000Z', endedAt: '21:00' })).toBe('recorded');
  });

  it('starting sets running and the writer, audited with kind and day', async () => {
    const { deps, ctx, userId, meeting } = await boardMeeting();
    const started = unwrap(await startMeeting(deps, ctx, { meetingId: meeting.id, startsAt: '19:10' }));
    expect(started).toMatchObject({ state: 'running', writerUserId: userId, startsAt: '19:10' });
    expect(started.startedAt).not.toBeNull();
    expect(auditOf(deps, 'governance.meeting.start')[0]!.params).toEqual({ kind: 'board', heldOn: '2026-09-05' });
    expect(await startMeeting(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingNotStartable' } });
  });

  it('Review Focus 5: a second person is not the writer until she takes over', async () => {
    const { deps, ctx, meeting } = await boardMeeting();
    unwrap(await startMeeting(deps, ctx, { meetingId: meeting.id }));
    const other = ctxWith(RECORDING, insertUser(deps, { name: 'Zweite', email: 'zweite@kompass.local' }));
    expect(requireWriterInternal(deps.db, ctx, meetingRowInternal(deps.db, meeting.id)!)).toBeNull();
    expect(await endMeeting(deps, other, { meetingId: meeting.id, endedAt: '21:00' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'notWriter' } });
    unwrap(await takeOverMinutes(deps, other, { meetingId: meeting.id }));
    expect(requireWriterInternal(deps.db, ctx, meetingRowInternal(deps.db, meeting.id)!)).toMatchObject({ ok: false, error: { code: 'notWriter' } });
    expect(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'notWriter' } });
    expect(auditOf(deps, 'governance.meeting.takeOver')[0]!.params).toEqual({ kind: 'board', heldOn: '2026-09-05' });
    expect(unwrap(await endMeeting(deps, other, { meetingId: meeting.id, endedAt: '21:00' })).state).toBe('recorded');
  });

  it('ending records the end, a recorded meeting reopens, an end before the start is refused', async () => {
    const { deps, ctx, meeting } = await boardMeeting();
    unwrap(await startMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '18:30' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const ended = unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:15' }));
    expect(ended).toMatchObject({ state: 'recorded', endedAt: '21:15' });
    expect(auditOf(deps, 'governance.meeting.end')[0]!.params).toEqual({ kind: 'board', heldOn: '2026-09-05', endedAt: '21:15' });
    expect(requireWriterInternal(deps.db, ctx, meetingRowInternal(deps.db, meeting.id)!)).toMatchObject({ ok: false, error: { code: 'meetingNotRunning' } });
    expect(unwrap(await reopenMeeting(deps, ctx, { meetingId: meeting.id }))).toMatchObject({ state: 'running', endedAt: null });
    expect(auditOf(deps, 'governance.meeting.reopen')).toHaveLength(1);
    expect(await takeOverMinutes(deps, ctx, { meetingId: (await boardMeeting()).meeting.id })).toMatchObject({ ok: false });
  });

  it('a cancelled meeting does not start; without governance.record it is forbidden', async () => {
    const { deps, ctx, meeting } = await boardMeeting();
    unwrap(await cancelMeeting(deps, ctx, { id: meeting.id, cancelledOn: '2026-09-01', reason: 'x' }));
    expect(await startMeeting(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingNotStartable' } });
    const manager = ctxWith(['governance.read', 'governance.manage'], ctx.userId!);
    expect(await startMeeting(deps, manager, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await startMeeting(deps, ctx, { meetingId: meeting.id, startsAt: '7 Uhr' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('the role for the minutes carries governance.record after install', () => {
    const { deps } = setupGovernance();
    const roles = deps.db.select().from(schema.roles).all().filter((r) => r.name === 'Vorstand' || r.name === 'Protokollführung');
    const keys = deps.db.select().from(schema.rolePermissions).all();
    for (const role of roles) expect(keys.filter((k) => k.roleId === role.id).map((k) => k.permissionKey), role.name).toContain('governance.record');
  });
});

describe('plausibility hints (G-25)', () => {
  it('a meeting started on another day than it is held warns startedOtherDay; an absent minute taker warns minuteTakerAbsent', async () => {
    const { createMeeting } = await import('../src/meetings');
    const { saveFindings } = await import('../src/findings');
    const { organOf, person: newPerson, session: run } = await import('./helpers');
    const { deps, ctx } = setupGovernance(RECORDING);
    const later = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'board'), kind: 'board', heldOn: '2026-11-12', startsAt: '19:00', form: 'inPerson' }));
    expect(unwrap(await startMeeting(deps, ctx, { meetingId: later.id })).warnings).toContain('startedOtherDay');
    const { meeting } = await run(deps, ctx, { items: ['simple'], voters: 2 });
    const absent = await newPerson(deps, 'Abwesend');
    expect(unwrap(await saveFindings(deps, ctx, { meetingId: meeting.id, findings: { minuteTakerContactId: absent } })).warnings).toContain('minuteTakerAbsent');
  });
});
