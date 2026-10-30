import { unwrap } from '@kompass/core';
import { documentLinks, documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { proposeAgenda } from '../src/agenda-proposal';
import { continueInvitationRun, getInvitationRun, previewInvitationRun, startInvitationRun } from '../src/invitation/runs';
import { cancelMeeting, createMeeting } from '../src/meetings';
import { governanceOrgans, governanceRunLetters } from '../src/schema';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { addressedPerson, asMcp, auditOf, member, minorMember, setupGovernance, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;
const head = { heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' as const, place: 'Vereinsheim' };

/** MV am 05.09.2026 mit Frist 14 Tage ab Zugang; vier Mitglieder: ordentlich (Mail), Fördermitglied (Post), minderjährig, ohne Anschrift. */
async function setup(now = '2026-08-10T08:00:00.000Z') {
  const env = setupGovernance(undefined, { now });
  const { deps, ctx } = env;
  const mv = organ(deps, 'assembly');
  const statute = unwrap(await createStatuteDraft(deps, ctx, {})).id;
  unwrap(await updateStatute(deps, ctx, { id: statute, resolutions: [{ on: '2026-07-20', resolutionId: null }], rules: { organs: { [mv]: { noticeDays: 14, motionDeadlineDays: 7 } } } }));
  const regular = await member(deps, { contactId: await addressedPerson(deps, { email: 'erika@example.org', lastName: 'Mail' }) });
  const supporting = await member(deps, { contactId: await addressedPerson(deps, { lastName: 'Foerder' }), type: 'supporting' });
  const guardian = await addressedPerson(deps, { lastName: 'Vormund' });
  const minor = await minorMember(deps, guardian);
  const unreachable = await member(deps, { contactId: await addressedPerson(deps, { address: false, lastName: 'Ohne' }) });
  const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', ...head }));
  unwrap(await proposeAgenda(deps, ctx, { meetingId: meeting.id }));
  return { ...env, mv, meeting, regular, supporting, guardian, minor, unreachable };
}

describe('previewInvitationRun', () => {
  it('lists every running membership with and without voting right, the letter to the guardian, and the missing address', async () => {
    const { deps, ctx, meeting, regular, supporting, guardian, minor, unreachable } = await setup();
    const preview = unwrap(await previewInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' }));
    const by = new Map(preview.recipients.map((r) => [r.membershipId, r]));
    expect(by.get(regular.membershipId)).toMatchObject({ contactId: regular.contactId, hasVotingRight: true, channel: 'email', refusal: null });
    expect(by.get(supporting.membershipId)).toMatchObject({ hasVotingRight: false, channel: 'post', refusal: null });
    expect(by.get(minor.membershipId)).toMatchObject({ contactId: guardian, refusal: null });
    expect(by.get(unreachable.membershipId)).toMatchObject({ refusal: 'addressMissing' });
    expect(preview.warnings).toEqual([]);
  });

  it('warns when the notice is too short for post', async () => {
    const { deps, ctx, meeting } = await setup('2026-08-19T08:00:00.000Z');
    expect(unwrap(await previewInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' })).warnings).toEqual(['noticeShort']);
  });
});

describe('startInvitationRun and continueInvitationRun', () => {
  it('Review Focus 3: issues one letter per member, to the guardian for a minor, refuses the unreachable and finishes', async () => {
    const { deps, ctx, meeting, minor, guardian, unreachable } = await setup();
    const run = unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' }));
    expect(run).toMatchObject({ status: 'running', issued: 0, pending: 4 });
    const master = deps.db.select().from(documents).where(eq(documents.id, run.masterDocumentId!)).get()!;
    expect(master.typeKey).toBe('governance-invitation');
    const done = unwrap(await continueInvitationRun(deps, ctx, { runId: run.id, max: 10 }));
    expect(done).toMatchObject({ status: 'done', issued: 3, pending: 0, refused: [{ membershipId: unreachable.membershipId, code: 'addressMissing' }] });
    const letter = deps.db.select().from(governanceRunLetters).all().find((l) => l.membershipId === minor.membershipId)!;
    expect(letter.contactId).toBe(guardian);
    const links = deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, letter.documentId)).all().map((l) => [l.entityType, l.role]);
    expect(links.sort()).toEqual([['contact', 'recipient'], ['governanceMeeting', 'about'], ['membership', 'about']].sort());
    expect(deps.db.select().from(documents).where(eq(documents.id, letter.documentId)).get()!.typeKey).toBe('governance-invitation-letter');
    expect(unwrap(await getInvitationRun(deps, ctx, { runId: run.id }))).toMatchObject({ status: 'done', issued: 3 });
  });

  it('marks the meeting invited, refuses a second invitation run, and audits without names', async () => {
    const { deps, ctx, meeting } = await setup();
    const run = unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' }));
    const { getMeeting } = await import('../src/meeting-detail');
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id }))).toMatchObject({ state: 'invited', invitedOn: '2026-08-10', invitationDocumentId: run.masterDocumentId });
    expect(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'invitationExists' } });
    unwrap(await continueInvitationRun(deps, ctx, { runId: run.id }));
    const start = auditOf(deps, 'governance.invitationRun.start')[0]!;
    expect(start.params).toMatchObject({ kind: 'invitation', meetingId: meeting.id });
    expect(auditOf(deps, 'governance.invitationRun.continue')[0]!.params).toEqual({ issued: 3, refused: 1 });
    expect(auditOf(deps, 'governance.invitation.letter')).toHaveLength(3);
    const all = JSON.stringify([...auditOf(deps, 'governance.invitationRun.start'), ...auditOf(deps, 'governance.invitationRun.continue'), ...auditOf(deps, 'governance.invitation.letter')]);
    expect(all).not.toMatch(/Erika|Lindenweg|Mail|Vormund/);
  });

  it('warns about a short notice at start, without refusing', async () => {
    const { deps, ctx, meeting } = await setup('2026-08-19T08:00:00.000Z');
    expect(unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' })).warnings).toEqual(['noticeShort']);
  });

  it('is human only, needs governance.manage and runs only for the assembly', async () => {
    const { deps, ctx, meeting } = await setup();
    expect(await startInvitationRun(deps, asMcp(ctx), { meetingId: meeting.id, kind: 'invitation' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    expect(await startInvitationRun(deps, { ...ctx, permissions: new Set(['governance.read']) }, { meetingId: meeting.id, kind: 'invitation' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    const board = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...head }));
    expect(await startInvitationRun(deps, ctx, { meetingId: board.id, kind: 'invitation' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'runNotForOrgan' } });
    expect(await previewInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'later' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('supplement only after a finished invitation; cancellation letters only for a cancelled meeting with letters', async () => {
    const { deps, ctx, meeting } = await setup();
    expect(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'supplement' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'invitationNotDone' } });
    const run = unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' }));
    unwrap(await continueInvitationRun(deps, ctx, { runId: run.id }));
    expect(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'cancellation' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cancellationWithoutLetters' } });
    const cancelled = unwrap(await cancelMeeting(deps, ctx, { id: meeting.id, cancelledOn: '2026-08-12', reason: 'Raum fehlt' }));
    expect(cancelled.cancellationLettersDue).toBe(true);
    const cancellation = unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'cancellation' }));
    expect(unwrap(await continueInvitationRun(deps, ctx, { runId: cancellation.id }))).toMatchObject({ status: 'done', issued: 3 });
  });
});
