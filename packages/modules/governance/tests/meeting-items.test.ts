import { unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getMeeting } from '../src/meeting-detail';
import { addMeetingItem, admitLateMotion } from '../src/meeting-items';
import { createMeeting } from '../src/meetings';
import { saveMotion } from '../src/motions';
import { decideResolution, saveResolution } from '../src/resolutions';
import { auditOf, organOf, RECORDING, session, setupGovernance, withRules } from './helpers';

describe('addMeetingItem', () => {
  it('a spontaneous statute change warns, other business does not', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['simple', 'other'], voters: 1 });
    const statute = unwrap(await addMeetingItem(deps, ctx, { meetingId: meeting.id, kind: 'statute', title: 'Satzungsänderung', afterItemId: items[0]!.id }));
    expect(statute).toMatchObject({ addedDuring: 'meeting', position: 2, warnings: ['notAnnounced'] });
    const other = unwrap(await addMeetingItem(deps, ctx, { meetingId: meeting.id, kind: 'other', title: 'Verschiedenes' }));
    expect(other).toMatchObject({ position: 4, warnings: [] });
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id })).agenda.map((i) => i.title)).toEqual(['TOP 1', 'Satzungsänderung', 'TOP 2', 'Verschiedenes']);
    expect(auditOf(deps, 'governance.agenda.save').at(-1)!.params).toEqual({ kind: 'other', position: 4 });
    const other2 = ctxWith(RECORDING, insertUser(deps, { name: 'B', email: 'b@kompass.local' }));
    expect(await addMeetingItem(deps, other2, { meetingId: meeting.id, kind: 'other', title: 'x' })).toMatchObject({ ok: false, error: { code: 'notWriter' } });
  });

  it('a mandate without recipient is refused', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: [], voters: 2 });
    const item = unwrap(await addMeetingItem(deps, ctx, { meetingId: meeting.id, kind: 'mandate', title: 'Auftrag' }));
    const details = { organId: null, officeId: null, dueOn: '2026-12-01', task: 'Angebote für einen Anhänger einholen' };
    expect(await saveResolution(deps, ctx, { agendaItemId: item.id, text: 'x', votedAt: '19:30', unanimous: true, details })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await saveResolution(deps, ctx, { agendaItemId: item.id, text: 'x', votedAt: '19:30', unanimous: true, details: { ...details, organId: organOf(deps, 'board') } })).toMatchObject({ ok: true });
  });
});

describe('admitLateMotion', () => {
  async function withLateMotion() {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { lateMotionMajority: { fraction: { num: 3, den: 4 }, base: 'cast', abstentions: 'ignored' } } });
    let motionId = '';
    const s = await session(deps, ctx, {
      items: ['other'],
      voters: 8,
      prepare: async (meetingId) => {
        motionId = unwrap(await saveMotion(deps, ctx, { meetingId, receivedOn: '2026-09-04', text: 'Anschaffung eines Anhängers' })).id;
      },
    });
    return { deps, ctx, motion: { id: motionId }, ...s };
  }

  it('6 yes, 2 no under 3/4: once adopted the item appears', async () => {
    const { deps, ctx, motion, meeting } = await withLateMotion();
    const { admission, item } = unwrap(await admitLateMotion(deps, ctx, { motionId: motion.id, votedAt: '19:30', votes: { yes: 6, no: 2, abstain: 0, invalid: 0 }, kind: 'simple' }));
    expect(item).toBeNull();
    expect(admission).toMatchObject({ kind: 'agenda', agendaItemId: null, evaluation: { required: { source: 'statute' }, result: { needed: 6, reached: true } } });
    unwrap(await decideResolution(deps, ctx, { id: admission.id, outcome: 'adopted' }));
    const detail = unwrap(await getMeeting(deps, ctx, { id: meeting.id }));
    const added = detail.agenda.find((i) => i.motionId === motion.id)!;
    expect(added).toMatchObject({ kind: 'simple', addedDuring: 'meeting' });
    expect(detail.motions[0]!.agendaItemId).toBe(added.id);
    expect(unwrap(await admitLateMotion(deps, ctx, { motionId: motion.id, votedAt: '19:30', votes: { yes: 6, no: 2, abstain: 0, invalid: 0 }, kind: 'simple' })).item!.id).toBe(added.id);
  });

  it('5 yes, 3 no: no item, the resolution stays', async () => {
    const { deps, ctx, motion, meeting } = await withLateMotion();
    const { admission } = unwrap(await admitLateMotion(deps, ctx, { motionId: motion.id, votedAt: '19:30', votes: { yes: 5, no: 3, abstain: 0, invalid: 0 }, kind: 'simple' }));
    expect(admission.evaluation!.result.reached).toBe(false);
    unwrap(await decideResolution(deps, ctx, { id: admission.id, outcome: 'rejected' }));
    const detail = unwrap(await getMeeting(deps, ctx, { id: meeting.id }));
    expect(detail.agenda.some((i) => i.motionId === motion.id)).toBe(false);
    expect(detail.motions[0]!.agendaItemId).toBeNull();
  });

  it('a motion of another meeting that is not running is refused', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-11-20', startsAt: '19:00', form: 'inPerson' }));
    const motion = unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: '2026-11-19', text: 'x' }));
    expect(await admitLateMotion(deps, ctx, { motionId: motion.id, votedAt: '19:30', unanimous: true, kind: 'simple' })).toMatchObject({ ok: false, error: { code: 'meetingNotRunning' } });
  });
});
