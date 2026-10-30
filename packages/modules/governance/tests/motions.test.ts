import { notifyRecordDeleted, unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { saveAgendaItem } from '../src/agenda';
import { getMeeting } from '../src/meeting-detail';
import { createMeeting, deleteMeeting } from '../src/meetings';
import { saveMotion } from '../src/motions';
import { governanceMotions, governanceOrgans } from '../src/schema';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { auditOf, person, setupGovernance, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;
const head = { heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' as const };

async function withMotionDeadline(deps: GovernanceDeps, ctx: Ctx) {
  const mv = organ(deps, 'assembly');
  const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
  unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-07-20', resolutionId: null }], rules: { organs: { [mv]: { noticeDays: 14, motionDeadlineDays: 7 } } } }));
  return unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', ...head }));
}

describe('saveMotion', () => {
  it('Review Focus 4: a motion one day after the deadline is late, stored and audited without names', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await withMotionDeadline(deps, ctx);
    const submittedByContactId = await person(deps, 'Antrag');
    const inTime = unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, submittedByContactId, receivedOn: '2026-08-28', text: 'Neue Hundehütte' }));
    const late = unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, submittedByContactId, receivedOn: '2026-08-29', text: 'Neuer Zaun' }));
    expect([inTime.late, late.late]).toEqual([false, true]);
    expect(auditOf(deps, 'governance.motion.save').map((e) => e.params)).toEqual([
      { meetingId: meeting.id, receivedOn: '2026-08-28', late: false },
      { meetingId: meeting.id, receivedOn: '2026-08-29', late: true },
    ]);
    expect(JSON.stringify(auditOf(deps, 'governance.motion.save'))).not.toContain('Zaun');
    const detail = unwrap(await getMeeting(deps, ctx, { id: meeting.id }));
    expect(detail.motions.map((m) => m.late)).toEqual([false, true]);
    expect(detail.deadlines).toMatchObject({ lastReceiptDay: '2026-08-21', motionsBy: '2026-08-28' });
  });

  it('Review Focus 4: without a motion deadline nothing is late', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'assembly'), kind: 'ordinary', ...head }));
    expect(unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: '2026-09-04', text: 'Spät' })).late).toBe(false);
  });

  it('refuses an agenda item of another meeting; a withdrawn motion stays visible', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await withMotionDeadline(deps, ctx);
    const other = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...head }));
    const foreign = unwrap(await saveAgendaItem(deps, ctx, { meetingId: other.id, kind: 'simple', title: 'Fremd' }));
    expect(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: '2026-08-01', text: 'x', agendaItemId: foreign.id })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const motion = unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: '2026-08-01', text: 'x' }));
    unwrap(await saveMotion(deps, ctx, { id: motion.id, meetingId: meeting.id, receivedOn: '2026-08-01', text: 'x', withdrawnOn: '2026-08-10' }));
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id })).motions).toMatchObject([{ id: motion.id, withdrawnOn: '2026-08-10' }]);
  });

  it('Review Focus 5 (part): a planned meeting with a motion is not deletable', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await withMotionDeadline(deps, ctx);
    unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: '2026-08-01', text: 'x' }));
    expect(await deleteMeeting(deps, ctx, { id: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingNotDeletable' } });
  });

  it('keeps the motion when its contact is deleted, without the reference', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await withMotionDeadline(deps, ctx);
    const contactId = await person(deps, 'Weg');
    const motion = unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, submittedByContactId: contactId, receivedOn: '2026-08-01', text: 'x' }));
    deps.db.transaction((tx) => notifyRecordDeleted(tx, deps, ctx, 'contact', contactId));
    expect(deps.db.select().from(governanceMotions).all()).toMatchObject([{ id: motion.id, submittedByContactId: null }]);
    expect(auditOf(deps, 'governance.motion.contactRemoved')).toHaveLength(1);
  });

  it('needs governance.manage and valid input', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await withMotionDeadline(deps, ctx);
    expect(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: 'gestern', text: 'x' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const reader = setupGovernance(['governance.read']);
    expect(await saveMotion(reader.deps, reader.ctx, { meetingId: meeting.id, receivedOn: '2026-08-01', text: 'x' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});
