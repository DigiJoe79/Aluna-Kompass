import { unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { documentLinks, documentRelations, documents, insertRelation, textPdf } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveAgendaItem } from '../src/agenda';
import { saveAttendance } from '../src/attendance';
import { backfillMeeting, correctBackfill } from '../src/backfill';
import { getMeetingContext } from '../src/meeting-context';
import { getMeeting } from '../src/meeting-detail';
import { saveElectionRound, acceptElection } from '../src/elections';
import { invitationComplianceInternal } from '../src/invitation/compliance';
import { createMeeting } from '../src/meetings';
import { composeMinutesInternal } from '../src/minutes/compose';
import { MINUTES_WORDS } from '../src/minutes/words';
import { attachSignedMinutes, fileSignedMinutes } from '../src/minutes/signed';
import { decideResolution, saveResolution } from '../src/resolutions';
import { previewSeal } from '../src/seal/preview';
import { sealMeeting } from '../src/seal/seal';
import { createStatuteDraft, getStatute, updateStatute } from '../src/statutes';
import { adopt, auditOf, elect, member, officeOf, organOf, person, receivedDocument, RECORDING, setupGovernance } from './helpers';

const head = { kind: 'founding' as const, heldOn: '2026-07-20', startsAt: '18:00', endedAt: '20:00', form: 'inPerson' as const, place: 'Vereinsheim', present: 7, voting: 7, chairBy: 'consent' as const };

describe('backfillMeeting', () => {
  it('founding: statute 7/0/0 under the law, three board elections, two auditors, a mandate — preview lists stand, terms, roles, initial occasion, follow-up', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const statute = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...head }));
    expect(meeting).toMatchObject({ state: 'recorded', backfilled: true, startedOn: '2026-07-20', endedAt: '20:00', backfillPresent: 7, backfillVoting: 7, writerUserId: null });
    expect(auditOf(deps, 'governance.meeting.backfill').at(-1)!.params).toEqual({ kind: 'founding', heldOn: '2026-07-20', present: 7, voting: 7 });

    const top = async (kind: 'statute' | 'election' | 'mandate', extra: Record<string, unknown> = {}) => unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind, title: kind, ...extra })).id;
    const statuteItem = await top('statute', { statuteId: statute });
    const s = unwrap(await saveResolution(deps, ctx, { agendaItemId: statuteItem, text: 'Die Satzung wird beschlossen.', votedAt: '18:10', votes: { yes: 7, no: 0, abstain: 0 } }));
    expect(s.evaluation).toMatchObject({ presentVoting: 7, result: { reached: true }, required: { source: 'law' } });
    unwrap(await decideResolution(deps, ctx, { id: s.id, outcome: 'adopted' }));
    for (const [i, fn] of (['chair', 'board', 'treasurer'] as const).entries()) await elect(deps, ctx, await top('election'), officeOf(deps, fn), await person(deps, `Vorstand ${fn}`), { votedAt: `18:2${i}` });
    const auditors = [await person(deps, 'Prüfer A'), await person(deps, 'Prüfer B')];
    const a = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: await top('election'), officeId: officeOf(deps, 'auditor'), votedAt: '18:40', round: { number: 1, runoff: false, candidates: auditors.map((contactId) => ({ contactId, votes: 7 })), no: 0, abstain: 0, invalid: 0, unanimousContactId: null } }));
    for (const contactId of auditors) unwrap(await acceptElection(deps, ctx, { resolutionId: a.id, contactId }));
    await adopt(deps, ctx, await top('mandate'), { details: { organId: organOf(deps, 'board'), officeId: null, dueOn: '2026-10-01', task: 'Eintragung beantragen' }, votedAt: '18:50' });
    for (const contactId of auditors) unwrap(await saveAttendance(deps, ctx, { meetingId: meeting.id, contactId, role: 'founder' }));
    expect(composeMinutesInternal(deps.db, deps, meeting.id).head.find((h) => h.label === MINUTES_WORDS.headAttendance)!.value).toBe(MINUTES_WORDS.attendanceHead(7, 7, 0, 0, 'assembly'));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['PRT-2026-001']) }));

    const preview = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    expect(preview.blockers).toEqual([]);
    const count = (kind: string) => preview.consequences.filter((c) => c.kind === kind).length;
    expect([count('numberResolution'), count('statuteResolved'), count('startTerm'), count('followUp'), count('memberProposal')]).toEqual([6, 1, 5, 1, 2]);
    expect(preview.consequences.filter((c) => c.kind === 'registerOccasion').map((c) => c.params.kind)).toEqual(['initial']);
    expect(preview.consequences.filter((c) => c.kind === 'startTerm').map((c) => c.params.roles)).toEqual(['board-member', 'board-member', 'board-member, treasurer', 'auditor', 'auditor']);
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(unwrap(await getStatute(deps, ctx, { id: statute })).resolutions).toEqual([{ on: '2026-07-20', resolutionId: s.id }]);
  });

  it('founding: before the statute item the law applies, after the adopted item the founding stand judges and the minutes cite it (Spec § 5.7)', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const assembly = organOf(deps, 'assembly');
    const present = { fraction: 'simple' as const, base: 'present' as const, abstentions: 'asNo' as const, comparison: 'atLeast' as const };
    const statute = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id: statute, rules: { organs: { [assembly]: { election: { mode: 'single', rounds: [present], runoff: false }, majorities: { simple: present } } }, references: { [assembly]: { election: '§ 14 Abs. 3 Satzung', 'majorities.simple': '§ 14 Abs. 3 Satzung' } } } }));
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: assembly, ...head }));
    const top = async (kind: 'simple' | 'statute' | 'election', extra: Record<string, unknown> = {}) => unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind, title: kind, ...extra })).id;

    const before = unwrap(await saveResolution(deps, ctx, { agendaItemId: await top('simple'), text: 'Vorab', votedAt: '18:05', votes: { yes: 7, no: 0, abstain: 0 } }));
    const statuteItem = await top('statute', { statuteId: statute });
    const after = await top('simple');
    const open = unwrap(await saveResolution(deps, ctx, { agendaItemId: after, text: 'Danach', votedAt: '18:30', votes: { yes: 7, no: 0, abstain: 0 } }));
    expect(open.evaluation!.required).toMatchObject({ source: 'law' });

    await adopt(deps, ctx, statuteItem, { details: { statuteId: statute }, votedAt: '18:10' });
    const person1 = await person(deps, 'Vorsitz');
    unwrap(await saveElectionRound(deps, ctx, { agendaItemId: await top('election'), officeId: officeOf(deps, 'chair'), votedAt: '18:40', round: { number: 1, runoff: false, candidates: [{ contactId: person1, votes: 7 }], no: 0, abstain: 0, invalid: 0, unanimousContactId: null } }));

    for (const id of [before.id, open.id]) unwrap(await decideResolution(deps, ctx, { id, outcome: 'adopted' }));
    const rows = unwrap(await getMeeting(deps, ctx, { id: meeting.id })).resolutions;
    expect(rows.find((r) => r.id === before.id)!.evaluation!.required).toMatchObject({ source: 'law' });
    expect(rows.find((r) => r.id === open.id)!.evaluation!.required).toMatchObject({ source: 'statute', reference: '§ 14 Abs. 3 Satzung' });
    const paragraphs = composeMinutesInternal(deps.db, deps, meeting.id).items.flatMap((i) => i.paragraphs);
    expect(paragraphs.filter((p) => p.includes('§ 14 Abs. 3 Satzung')).length).toBeGreaterThanOrEqual(2);
    expect(paragraphs.filter((p) => p.includes('§ 32 Abs. 1 S. 3 BGB')).length).toBe(1);
    const context = unwrap(await getMeetingContext(deps, ctx, { meetingId: meeting.id }));
    expect(context.rules.majorities[after]).toMatchObject({ source: 'statute' });
  });

  it('G-25: a backfilled assembly before the earliest membership Kompass keeps warns; after it, a board meeting or the founding do not', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await member(deps, { admittedOn: '2025-01-01' });
    const before = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...head, kind: 'ordinary', heldOn: '2024-05-15' }));
    expect(before.warnings).toContain('beforeMemberRecords');
    const after = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...head, kind: 'ordinary', heldOn: '2025-05-15' }));
    expect(after.warnings).not.toContain('beforeMemberRecords');
    const founding = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...head, heldOn: '2024-01-15' }));
    expect(founding.warnings).not.toContain('beforeMemberRecords');
  });

  it('writing to a backfilled meeting needs manage, not the writer', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...head, kind: 'ordinary' }));
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Antrag' })).id;
    const other = ctxWith(RECORDING, insertUser(deps, { name: 'Andere', email: 'andere@kompass.local' }));
    expect(await saveResolution(deps, other, { agendaItemId: item, text: 'x', votedAt: '18:10', unanimous: true })).toMatchObject({ ok: true });
    expect(await saveResolution(deps, ctxWith(['governance.read', 'governance.record'], userId), { agendaItemId: item, text: 'x', votedAt: '18:10', unanimous: true })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await backfillMeeting(deps, ctxWith(['governance.read', 'governance.record'], userId), { organId: organOf(deps, 'assembly'), ...head, kind: 'ordinary' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...head, kind: 'ordinary', voting: 8 })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('a statute change at an existing stand fills its hand-written entry instead of adding one', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const statute = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id: statute, resolutions: [{ on: '2026-09-05', resolutionId: null }] }));
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...head, kind: 'extraordinary', heldOn: '2026-09-05' }));
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'statute', title: 'Satzungsänderung', statuteId: statute })).id;
    const r = await adopt(deps, ctx, item, { votedAt: '18:10' });
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    expect(unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).consequences.map((c) => c.kind)).toEqual(['numberResolution', 'statuteResolved', 'registerOccasion']);
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(unwrap(await getStatute(deps, ctx, { id: statute })).resolutions).toEqual([{ on: '2026-09-05', resolutionId: r.id }]);
  });
});

describe('correctBackfill', () => {
  const ordinary = { ...head, kind: 'extraordinary' as const, heldOn: '2026-09-05', chairBy: null };

  it('fixes kind, numbers and the invitation of an unsealed backfill and audits field names only', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...ordinary }));
    const fixed = unwrap(await correctBackfill(deps, ctx, { id: meeting.id, kind: 'ordinary', present: 6, voting: 5, invitedOn: '2026-08-20', invitationNote: 'per E-Mail' }));
    expect(fixed).toMatchObject({ kind: 'ordinary', state: 'recorded', backfillPresent: 6, backfillVoting: 5, invitedOn: '2026-08-20', invitationNote: 'per E-Mail' });
    expect(auditOf(deps, 'governance.meeting.backfillCorrect').at(-1)!.params).toEqual({ kind: 'ordinary', heldOn: '2026-09-05', fields: 'kind, present, voting, invitedOn, invitationNote' });
  });

  it('a corrected day moves the decision day of the resolutions', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...ordinary }));
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Punkt' }));
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: item.id, text: 'Beschluss', votedAt: '18:10', votes: { yes: 7, no: 0, abstain: 0 } }));
    unwrap(await correctBackfill(deps, ctx, { id: meeting.id, heldOn: '2026-09-06' }));
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id }))).toMatchObject({ heldOn: '2026-09-06', startedOn: '2026-09-06', resolutions: [{ id: r.id, decidedOn: '2026-09-06' }] });
  });

  it('counts the invitation day of a backfilled assembly against the notice', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...ordinary }));
    unwrap(await correctBackfill(deps, ctx, { id: meeting.id, invitedOn: '2026-08-01' }));
    expect(invitationComplianceInternal(deps.db, deps, meeting.id)).toMatchObject({ letters: 1, unsent: 0, late: 0 });
  });

  it('typing an old agenda in today is no change after the invitation', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: '2026-10-30T08:00:00.000Z' });
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...ordinary }));
    unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Punkt' }));
    unwrap(await correctBackfill(deps, ctx, { id: meeting.id, invitedOn: '2026-08-20' }));
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id })).agenda).toEqual([expect.objectContaining({ warnings: [] })]);
  });

  it('an invitation the file already keeps as attachment of the old minutes does not stop linking them', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...ordinary }));
    const [minutes, invitation] = [await receivedDocument(deps, 'Protokoll'), await receivedDocument(deps, 'Einladung')];
    const [protocol, scan] = [minutes, invitation].map((id) => deps.db.select().from(documents).where(eq(documents.id, id)).get()!);
    deps.db.transaction((tx) => insertRelation(tx, deps, ctx, { documentId: invitation, relatedDocumentId: minutes, kind: 'attachmentOf' }, scan!, protocol!));
    const reader = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view']) };
    unwrap(await correctBackfill(deps, reader, { id: meeting.id, invitationDocumentId: invitation }));
    expect(await attachSignedMinutes(deps, reader, { meetingId: meeting.id, documentId: minutes })).toMatchObject({ ok: true });
    expect(deps.db.select().from(documentRelations).where(eq(documentRelations.documentId, invitation)).all()).toHaveLength(1);
  });

  it('links the invitation document to the meeting, an unknown one is refused', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...ordinary }));
    expect(await correctBackfill(deps, ctx, { id: meeting.id, invitationDocumentId: 'unbekannt' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    const scan = await receivedDocument(deps, 'Einladung');
    expect(await correctBackfill(deps, ctx, { id: meeting.id, invitationDocumentId: scan })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    const reader = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view']) };
    expect(unwrap(await correctBackfill(deps, reader, { id: meeting.id, invitedOn: '2026-08-20', invitationDocumentId: scan })).invitationDocumentId).toBe(scan);
    expect(deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, scan)).all()).toMatchObject([{ entityType: 'governanceMeeting', entityId: meeting.id }]);
  });

  it('refuses without a change, end before start, more voting than present', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...ordinary }));
    for (const change of [{}, { endedAt: '17:00' }, { voting: 8 }]) expect(await correctBackfill(deps, ctx, { id: meeting.id, ...change })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('refuses a meeting that is no backfill or already sealed', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const planned = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-12-01', startsAt: '18:00', form: 'inPerson' }));
    expect(await correctBackfill(deps, ctx, { id: planned.id, kind: 'extraordinary' })).toMatchObject({ ok: false, error: { code: 'meetingNotBackfilled' } });
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), ...ordinary }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['PRT']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(await correctBackfill(deps, ctx, { id: meeting.id, kind: 'ordinary' })).toMatchObject({ ok: false, error: { code: 'meetingNotBackfilled' } });
  });
});
