import { describe, expect, it } from 'vitest';
import { meetingBadge } from '@/lib/governance/meeting-state';

const m = (state: Parameters<typeof meetingBadge>[0]['state'], inviteBy: string | null = '2026-10-20') => ({ state, heldOn: '2026-11-12', inviteBy });

describe('meetingBadge', () => {
  it('signed carries no badge in lists', () => {
    expect(meetingBadge(m('signed'), '2026-10-01', 7)).toBeNull();
  });

  it('planned turns into „Einladung bis …“ from lead days before inviteBy, and stays so when overdue', () => {
    expect(meetingBadge(m('planned'), '2026-10-12', 7)).toEqual({ status: 'planned' });
    expect(meetingBadge(m('planned'), '2026-10-13', 7)).toEqual({ status: 'inviteDue', date: '2026-10-20' });
    expect(meetingBadge(m('planned'), '2026-10-25', 7)).toEqual({ status: 'inviteDue', date: '2026-10-20' });
    expect(meetingBadge(m('planned', null), '2026-11-11', 7)).toEqual({ status: 'planned' });
  });

  it('the other states stay as they are', () => {
    for (const state of ['invited', 'running', 'recorded', 'cancelled'] as const) expect(meetingBadge(m(state), '2026-10-25', 7)).toEqual({ status: state });
  });
});
