import { describe, expect, it } from 'vitest';
import { meetingSteps, type MeetingStepKey } from '@/lib/governance/meeting-steps';

type Input = Parameters<typeof meetingSteps>[0];
const base: Input = { state: 'planned', heldOn: '2026-11-12', organKind: 'assembly', invitedOn: null, dispatchDone: null, minutesFiled: false, openPoints: 0 };
const before = '2026-11-01';
const on = '2026-11-12';
const done = (r: ReturnType<typeof meetingSteps>) => (Object.keys(r.done) as MeetingStepKey[]).filter((k) => r.done[k]);

describe('meetingSteps', () => {
  it('signed: all done, none active; cancelled: nothing', () => {
    expect(meetingSteps({ ...base, state: 'signed', invitedOn: '2026-10-01', dispatchDone: true, minutesFiled: true }, on)).toEqual({ active: null, done: { prepare: true, invite: true, meeting: true, minutes: true, seal: true } });
    const cancelled = meetingSteps({ ...base, state: 'cancelled' }, before);
    expect(cancelled.active).toBeNull();
    expect(done(cancelled)).toEqual([]);
  });

  it('recorded: minutes until a version is filed, then seal — open points do not hold', () => {
    expect(meetingSteps({ ...base, state: 'recorded', invitedOn: '2026-10-01', dispatchDone: true }, on).active).toBe('minutes');
    expect(meetingSteps({ ...base, state: 'recorded', invitedOn: '2026-10-01', dispatchDone: true, minutesFiled: true, openPoints: 2 }, on).active).toBe('seal');
    expect(done(meetingSteps({ ...base, state: 'recorded', invitedOn: '2026-10-01', dispatchDone: true }, on))).toEqual(['prepare', 'invite', 'meeting']);
  });

  it('running → meeting; planned or invited on the day or later → meeting', () => {
    expect(meetingSteps({ ...base, state: 'running' }, on).active).toBe('meeting');
    expect(meetingSteps({ ...base, state: 'planned' }, on).active).toBe('meeting');
    expect(meetingSteps({ ...base, state: 'invited', invitedOn: '2026-10-01', dispatchDone: false }, '2026-11-13').active).toBe('meeting');
    expect(meetingSteps({ ...base, state: 'planned' }, on).done.prepare).toBe(true);
  });

  it('invited before the day: invite while the dispatch is open, then meeting', () => {
    expect(meetingSteps({ ...base, state: 'invited', invitedOn: '2026-10-01', dispatchDone: false }, before).active).toBe('invite');
    const sent = meetingSteps({ ...base, state: 'invited', invitedOn: '2026-10-01', dispatchDone: true }, before);
    expect(sent.active).toBe('meeting');
    expect(sent.done.invite).toBe(true);
    // Vorstand: kein Serienlauf, eingeladen heißt erledigt.
    expect(meetingSteps({ ...base, organKind: 'board', state: 'invited', invitedOn: '2026-10-01', dispatchDone: null }, before)).toMatchObject({ active: 'meeting', done: { prepare: true, invite: true } });
  });

  it('planned before the day: prepare', () => {
    expect(meetingSteps(base, before)).toEqual({ active: 'prepare', done: { prepare: false, invite: false, meeting: false, minutes: false, seal: false } });
  });

  it('never more than one step active', () => {
    for (const state of ['planned', 'invited', 'running', 'recorded', 'signed', 'cancelled'] as const)
      for (const today of [before, on])
        for (const dispatchDone of [null, false, true])
          for (const minutesFiled of [false, true]) {
            const r = meetingSteps({ ...base, state, invitedOn: state === 'planned' ? null : '2026-10-01', dispatchDone, minutesFiled }, today);
            expect(r.active === null || typeof r.active === 'string').toBe(true);
            if (r.active) expect(r.done[r.active]).toBe(false);
          }
  });
});
