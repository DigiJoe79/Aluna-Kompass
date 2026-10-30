import { unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { agendaItemsInternal } from '../src/agenda';
import { recordFloorMotion } from '../src/floor-motions';
import { admitLateMotion } from '../src/meeting-items';
import { createMeeting } from '../src/meetings';
import { decideResolution } from '../src/resolutions';
import { auditOf, GOVERNANCE_PERMISSIONS, organOf, RECORDING, session, setupGovernance, withRules } from './helpers';

describe('recordFloorMotion', () => {
  it('records a motion on the meeting day, late with a motion deadline; admitted it lands right after the current item', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { motionDeadlineDays: 7 } });
    const { meeting, items, contactIds } = await session(deps, ctx, { items: ['report', 'simple', 'other'], voters: 3 });
    const motion = unwrap(await recordFloorMotion(deps, ctx, { meetingId: meeting.id, submittedByContactId: contactIds[0]!, text: 'Wir kaufen ein Zelt.', kind: 'simple', afterItemId: items[0]!.id }));
    expect(motion).toMatchObject({ receivedOn: meeting.heldOn, late: true, agendaItemId: null });
    expect(auditOf(deps, 'governance.motion.save').at(-1)!.params).toEqual({ meetingId: meeting.id, receivedOn: meeting.heldOn, late: true });

    const admission = unwrap(await admitLateMotion(deps, ctx, { motionId: motion.id, votedAt: '19:30', unanimous: true, kind: 'simple' })).admission;
    unwrap(await decideResolution(deps, ctx, { id: admission.id, outcome: 'adopted' }));
    const agenda = agendaItemsInternal(deps.db, meeting.id);
    expect(agenda.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(agenda[1]).toMatchObject({ motionId: motion.id, addedDuring: 'meeting', kind: 'simple' });
    expect(agenda[2]!.id).toBe(items[1]!.id);
  });

  it('without a motion deadline the motion is not late; without afterItemId the item is appended', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['report', 'simple'], voters: 2 });
    const motion = unwrap(await recordFloorMotion(deps, ctx, { meetingId: meeting.id, submittedByContactId: null, text: 'Antrag', kind: 'simple' }));
    expect(motion.late).toBe(false);
    const admission = unwrap(await admitLateMotion(deps, ctx, { motionId: motion.id, votedAt: '19:30', unanimous: true, kind: 'simple' })).admission;
    unwrap(await decideResolution(deps, ctx, { id: admission.id, outcome: 'adopted' }));
    expect(agendaItemsInternal(deps.db, meeting.id).map((i) => i.id).slice(0, 2)).toEqual(items.map((i) => i.id));
  });

  it('forbidden, validation, meetingNotRunning, notWriter', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: ['simple'], voters: 1 });
    const input = { meetingId: meeting.id, text: 'Antrag', kind: 'simple' };
    expect(await recordFloorMotion(deps, ctxWith(GOVERNANCE_PERMISSIONS, ctx.userId), input)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await recordFloorMotion(deps, ctx, { ...input, text: ' ' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await recordFloorMotion(deps, ctxWith(RECORDING, insertUser(deps, { name: 'B', email: 'b@kompass.local' })), input)).toMatchObject({ ok: false, error: { code: 'notWriter' } });
    const planned = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-11-05', startsAt: '19:00', form: 'inPerson' }));
    expect(await recordFloorMotion(deps, ctx, { ...input, meetingId: planned.id })).toMatchObject({ ok: false, error: { code: 'meetingNotRunning' } });
  });
});
