import { unwrap } from '@kompass/core';
import { applyDispatchInternal, documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { proposeAgenda } from '../src/agenda-proposal';
import { recordInvitationNote } from '../src/invitation/board';
import { invitationComplianceInternal } from '../src/invitation/compliance';
import { continueInvitationRun, startInvitationRun } from '../src/invitation/runs';
import { createMeeting } from '../src/meetings';
import { governanceOrgans, governanceRunLetters } from '../src/schema';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { addressedPerson, member, setupGovernance } from './helpers';

/** MV am 05.09.2026, Frist 14 Tage ab Zugang (letzter Zugang 21.08.), ein Mitglied, ein Brief. */
async function setup(opts: { rules?: boolean; members?: number } = {}) {
  const env = setupGovernance(undefined, { now: '2026-08-10T08:00:00.000Z' });
  const { deps, ctx } = env;
  const organs = deps.db.select().from(governanceOrgans).all();
  const mv = organs.find((o) => o.kind === 'assembly')!.id;
  if (opts.rules !== false) {
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-07-20', resolutionId: null }], rules: { organs: { [mv]: { noticeDays: 14 } } } }));
  }
  for (let i = 0; i < (opts.members ?? 1); i += 1) await member(deps, { contactId: await addressedPerson(deps) });
  const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
  unwrap(await proposeAgenda(deps, ctx, { meetingId: meeting.id }));
  const run = unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' }));
  unwrap(await continueInvitationRun(deps, ctx, { runId: run.id }));
  const letters = deps.db.select().from(governanceRunLetters).all().map((l) => l.documentId);
  const dispatch = (documentId: string, sentAt: string, sentVia: string) =>
    deps.db.transaction((tx) => applyDispatchInternal(tx, deps, ctx, tx.select().from(documents).where(eq(documents.id, documentId)).get()!, { sentAt, sentVia, note: null }));
  return { ...env, meeting, letters, dispatch, board: organs.find((o) => o.kind === 'board')!.id };
}

describe('invitationComplianceInternal', () => {
  it('a letter posted on 19.08. arrives on 22.08., after the last day of receipt', async () => {
    const { deps, meeting, letters, dispatch } = await setup();
    dispatch(letters[0]!, '2026-08-19', 'post');
    expect(invitationComplianceInternal(deps.db, deps, meeting.id)).toEqual({ lastReceiptDay: '2026-08-21', letters: 1, unsent: 0, late: 1, missing: 0, ok: false });
  });

  it('a mail on 20.08. arrives in time', async () => {
    const { deps, meeting, letters, dispatch } = await setup();
    dispatch(letters[0]!, '2026-08-20', 'email');
    expect(invitationComplianceInternal(deps.db, deps, meeting.id)).toMatchObject({ late: 0, ok: true });
  });

  it('an unsent letter is not ok; without a deadline there is no verdict', async () => {
    const { deps, meeting, letters, dispatch } = await setup({ members: 2 });
    dispatch(letters[0]!, '2026-08-12', 'post');
    expect(invitationComplianceInternal(deps.db, deps, meeting.id)).toMatchObject({ letters: 2, unsent: 1, ok: false });
    const lawOnly = await setup({ rules: false });
    expect(invitationComplianceInternal(lawOnly.deps.db, lawOnly.deps, lawOnly.meeting.id)).toMatchObject({ lastReceiptDay: null, ok: null });
  });

  it('a board meeting invited by note on time is ok', async () => {
    const { deps, ctx, board } = await setup();
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-07-21', resolutionId: null }], rules: { organs: { [board]: { noticeDays: 7 } } } }));
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: board, kind: 'board', heldOn: '2026-08-20', startsAt: '19:00', form: 'inPerson' }));
    unwrap(await recordInvitationNote(deps, ctx, { meetingId: meeting.id, invitedOn: '2026-08-10', note: 'Messenger' }));
    expect(invitationComplianceInternal(deps.db, deps, meeting.id)).toEqual({ lastReceiptDay: '2026-08-12', letters: 1, unsent: 0, late: 0, missing: 0, ok: true });
  });
});

describe('W-14: short notice shows at the meeting; a passed motions deadline at the run', () => {
  it('a late letter makes noticeShort a warning of the meeting itself', async () => {
    const { deps, ctx, meeting, letters, dispatch } = await setup();
    const { getMeeting } = await import('../src/meeting-detail');
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id })).warnings).not.toContain('noticeShort');
    dispatch(letters[0]!, '2026-08-19', 'post');
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id })).warnings).toContain('noticeShort');
  });

  it('the run preview warns when the motions deadline the letter names has already passed', async () => {
    const env = setupGovernance(undefined, { now: '2026-08-10T08:00:00.000Z' });
    const { deps, ctx } = env;
    const mv = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'assembly')!.id;
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-07-20', resolutionId: null }], rules: { organs: { [mv]: { noticeDays: 14, motionDeadlineDays: 30 } } } }));
    await member(deps, { contactId: await addressedPerson(deps) });
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
    const { previewInvitationRun } = await import('../src/invitation/runs');
    expect(unwrap(await previewInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' })).warnings).toContain('motionsByPassed');
  });
});
