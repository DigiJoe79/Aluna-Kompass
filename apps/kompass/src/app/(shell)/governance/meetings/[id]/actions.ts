'use server';

import { acceptElection, cancelMeeting, deleteMeeting, fileSignedMinutes, getMeeting, issueAttendanceList, issueBoardInvitation, issueRegisterData, reopenMeeting, replaceSignedMinutes, sealMeeting, markInvitationPostDispatched, moveInvitationLetters, prefillAttendance, proposeAgenda, recordInvitationNote, removeAgendaItem, reorderAgenda, saveAgendaItem, saveMotion, sendBoardInvitation, sendInvitationMails, startInvitationRun, startMeeting, correctMinutes } from '@kompass/module-governance';
import { resendDocumentEmail } from '@kompass/module-dms';
import { kickMailSender } from '@/lib/background';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Sitzung als Vorgang (Plan U1 Task 5). Jede ruft einen Dienst aus `@kompass/module-governance`;
 * Rechte, Prüfungen und Protokoll stehen dort.
 */
function revalidate(meetingId: string): void {
  revalidatePath('/governance/meetings');
  revalidatePath(`/governance/meetings/${meetingId}`);
}

export interface AgendaItemInput {
  id?: string;
  meetingId: string;
  kind: string;
  title: string;
  proposal: string | null;
  attachmentDocumentIds: string[];
  officeIds: string[];
  fiscalYearId: string | null;
  statuteId: string | null;
  motionId: string | null;
  /** Nur Satzungs- und Zweckänderung: geänderte Absätze (Plan U2). */
  wordingChanges?: { label: string; before: string; after: string }[];
}

export async function saveAgendaItemAction(input: AgendaItemInput): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#saveAgendaItemAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveAgendaItem(deps, ctx, input);
    revalidate(input.meetingId);
    return toActionState(result, t);
  });
}

export async function removeAgendaItemAction(meetingId: string, id: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#removeAgendaItemAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await removeAgendaItem(deps, ctx, { id });
    revalidate(meetingId);
    return toActionState(result, t);
  });
}

export async function reorderAgendaAction(meetingId: string, itemIds: string[]): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#reorderAgendaAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await reorderAgenda(deps, ctx, { meetingId, itemIds });
    revalidate(meetingId);
    return toActionState(result, t);
  });
}

export async function proposeAgendaAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#proposeAgendaAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await proposeAgenda(deps, ctx, { meetingId });
    revalidate(meetingId);
    return toActionState(result, t);
  });
}

export interface MotionInput {
  id?: string;
  meetingId: string;
  submittedByContactId: string | null;
  receivedOn: string;
  text: string;
  documentId: string | null;
  agendaItemId?: string | null;
  withdrawnOn?: string | null;
}

export async function saveMotionAction(input: MotionInput): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#saveMotionAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveMotion(deps, ctx, input);
    revalidate(input.meetingId);
    return toActionState(result, t);
  });
}

export async function cancelMeetingAction(input: { id: string; cancelledOn: string; reason: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#cancelMeetingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await cancelMeeting(deps, ctx, input);
    revalidate(input.id);
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: t('governance.meeting.cancelDialog.done'), data: { lettersDue: result.value.cancellationLettersDue } };
  });
}

export async function deleteMeetingAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#deleteMeetingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteMeeting(deps, ctx, { id });
    revalidatePath('/governance/meetings');
    if (!result.ok) return toActionState(result, t);
    redirect('/governance/meetings');
  });
}

/** „Sitzung beginnen“: beginnt, belegt die leere Anwesenheit vor und öffnet den Mitlauf. */
export async function startMeetingAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#startMeetingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const started = await startMeeting(deps, ctx, { meetingId });
    revalidate(meetingId);
    if (!started.ok) return toActionState(started, t);
    const detail = await getMeeting(deps, ctx, { id: meetingId });
    if (detail.ok && detail.value.attendance.length === 0 && detail.value.kind !== 'founding') {
      const prefilled = await prefillAttendance(deps, ctx, { meetingId });
      if (!prefilled.ok) return toActionState(prefilled, t);
    }
    redirect(`/governance/meetings/${meetingId}/live`);
  });
}

/** Einladungslauf ausstellen (Serienlauf-Seite; nur ein Mensch, der Dienst prüft): danach zurück zu Schritt 2. */
export async function startInvitationRunAction(meetingId: string, kind: 'invitation' | 'supplement' | 'cancellation'): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#startInvitationRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await startInvitationRun(deps, ctx, { meetingId, kind });
    revalidate(meetingId);
    if (!result.ok) return toActionState(result, t);
    redirect(`/governance/meetings/${meetingId}#step-invite`);
  });
}

export async function sendInvitationMailsAction(meetingId: string, runId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#sendInvitationMailsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await sendInvitationMails(deps, ctx, { runId });
    revalidate(meetingId);
    if (!result.ok) return toActionState(result, t);
    kickMailSender();
    return { status: 'success', message: t('dispatchStep.sending', { count: result.value.queued }) };
  });
}

export async function markInvitationPostAction(meetingId: string, input: { runId: string; documentIds: string[]; sentAt: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#markInvitationPostAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await markInvitationPostDispatched(deps, ctx, input);
    revalidate(meetingId);
    return toActionState(result, t);
  });
}

export async function moveInvitationLettersAction(meetingId: string, input: { runId: string; documentIds: string[]; to: 'post' | 'email' }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#moveInvitationLettersAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await moveInvitationLetters(deps, ctx, input);
    revalidate(meetingId);
    return toActionState(result, t, t(input.to === 'post' ? 'dispatchStep.movedToPost' : 'dispatchStep.movedToEmail'));
  });
}

/** „Erneut senden“ an einer nicht zugestellten Zeile (Akte, wie bei den Läufen der Mitglieder). */
export async function resendInvitationMailAction(outboxId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#resendInvitationMailAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resendDocumentEmail(deps, ctx, { outboxId });
    if (result.ok) kickMailSender();
    return toActionState(result, t, t('dispatchStep.resent'));
  });
}

/** Vorstand: die eine Einladung ausstellen. */
export async function issueBoardInvitationAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#issueBoardInvitationAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await issueBoardInvitation(deps, ctx, { meetingId });
    revalidate(meetingId);
    return toActionState(result, t, t('governance.invite.board.issued'));
  });
}

/** Vorstand: die Einladung per E-Mail an die Amtsinhaber. */
export async function sendBoardInvitationAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#sendBoardInvitationAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await sendBoardInvitation(deps, ctx, { meetingId });
    revalidate(meetingId);
    if (!result.ok) return toActionState(result, t);
    kickMailSender();
    return { status: 'success', message: t('governance.invite.board.sent', { mail: result.value.queued, post: result.value.post }) };
  });
}

/** Vorstand: „eingeladen am … per Messenger“. */
export async function recordInvitationNoteAction(input: { meetingId: string; invitedOn: string; note: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#recordInvitationNoteAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await recordInvitationNote(deps, ctx, input);
    revalidate(input.meetingId);
    return toActionState(result, t, t('governance.invite.board.noted'));
  });
}

/** G-13: die abgelegte Fassung vor dem Festschreiben ersetzen — das Dokument wird in der Akte storniert. */
export async function replaceSignedMinutesAction(meetingId: string, reason: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#replaceSignedMinutesAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await replaceSignedMinutes(deps, ctx, { meetingId, reason });
    revalidate(meetingId);
    return toActionState(result, t, t('governance.minutes.replaced'));
  });
}

/** Die unterschriebene Fassung als Scan ablegen (`FormData` wie bei der Zuwendungsbestätigung — sonst scheitert ein großer Upload stumm). */
export async function fileSignedMinutesAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#fileSignedMinutesAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const meetingId = String(formData.get('meetingId') ?? '');
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await fileSignedMinutes(deps, ctx, { meetingId, bytes: new Uint8Array(await file.arrayBuffer()) });
    revalidate(meetingId);
    return toActionState(result, t, t('governance.minutes.filed'));
  });
}

/** „Berichtigen …“ (Planprüfung Entscheidung 5): neue unterschriebene Fassung mit Grund — nur hier in Kompass. */
export async function correctMinutesAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#correctMinutesAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const meetingId = String(formData.get('meetingId') ?? '');
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await correctMinutes(deps, ctx, { meetingId, reason: String(formData.get('reason') ?? ''), bytes: new Uint8Array(await file.arrayBuffer()) });
    revalidate(meetingId);
    return toActionState(result, t, t('governance.meeting.correctDialog.done'));
  });
}

export async function issueAttendanceListAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#issueAttendanceListAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await issueAttendanceList(deps, ctx, { meetingId });
    revalidate(meetingId);
    return toActionState(result, t, t('governance.minutes.issued'));
  });
}

export async function issueRegisterDataAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#issueRegisterDataAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await issueRegisterData(deps, ctx, { meetingId });
    revalidate(meetingId);
    return toActionState(result, t, t('governance.minutes.issued'));
  });
}

/** Annahme oder Ablehnung einer Wahl nach der Sitzung (der Dienst nimmt sie auch nach dem Festschreiben an). */
export async function acceptLaterAction(meetingId: string, input: { resolutionId: string; contactId: string; acceptedOn: string; declined: boolean }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#acceptLaterAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await acceptElection(deps, ctx, { resolutionId: input.resolutionId, contactId: input.contactId, acceptedOn: input.acceptedOn, ...(input.declined ? { declined: true } : {}) });
    revalidate(meetingId);
    return toActionState(result, t);
  });
}

/** Festschreiben (nur ein Mensch; der Dienst prüft Kanal und Blocker). */
export async function sealMeetingAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#sealMeetingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await sealMeeting(deps, ctx, { meetingId });
    revalidate(meetingId);
    return toActionState(result, t, t('governance.seal.done'));
  });
}

/** Mitlauf wieder öffnen, solange keine unterschriebene Fassung abgelegt ist; danach in den Mitlauf. */
export async function reopenMeetingAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/actions.ts#reopenMeetingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await reopenMeeting(deps, ctx, { meetingId });
    revalidate(meetingId);
    if (!result.ok) return toActionState(result, t);
    redirect(`/governance/meetings/${meetingId}/live`);
  });
}
