import { invalid, isoNow, notFound, ok, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { abortIssue, documentLinks, issueGeneratedDocument, mailNotReady, queueDocumentEmailsInternal } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from '../errors';
import { meetingRowInternal, meetingStateOf, meetingView, type MeetingView } from '../meetings';
import { governanceMeetings, governanceOffices, governanceOrgans, governanceTerms, type MeetingRow } from '../schema';
import { termRunsOn } from '../term-schedule';
import { invitationFactsInternal } from './facts';
import { HUMAN_ONLY_SETTING } from './runs';
import { INVITATION_TEMPLATE_KEY } from './template';

const id = z.string().min(1);
export const boardInvitationSchema = z.object({ meetingId: id });
export const invitationNoteSchema = z.object({ meetingId: id, invitedOn: z.iso.date(), note: z.string().trim().min(1).max(500) });

/** Die einfache Einladung gibt es für Vorstand und andere Organe, nicht für die Mitgliederversammlung (dort: Lauf). */
function refuse(db: DbOrTx, meeting: MeetingRow): Failure | null {
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get();
  if (organ?.kind === 'assembly') return governanceConflict('runNotForOrgan');
  const state = meetingStateOf(meeting);
  if (state === 'cancelled') return governanceConflict('meetingCancelled');
  if (state !== 'planned') return governanceConflict('invitationExists');
  return null;
}

/** Die Amtsinhaber des Organs am Sitzungstag (Kontakte, ohne Doppelte). */
export function organMembersOnInternal(db: DbOrTx, organId: string, day: string): string[] {
  const offices = new Map(db.select().from(governanceOffices).where(eq(governanceOffices.organId, organId)).all().map((o) => [o.id, o]));
  const terms = db.select().from(governanceTerms).all().filter((t) => offices.has(t.officeId) && termRunsOn(t, offices.get(t.officeId)!, day));
  return [...new Set(terms.map((t) => t.contactId))];
}

async function loadMeeting(deps: Deps, input: unknown, schema: z.ZodType<{ meetingId: string }>): Promise<Result<MeetingRow>> {
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const meeting = meetingRowInternal(deps.db, parsed.value.meetingId);
  return meeting ? ok(meeting) : notFound('governanceMeeting', parsed.value.meetingId);
}

/** Einfache Einladung (nur ein Mensch): ein Dokument `ELD` an die Amtsinhaber am Sitzungstag; die Sitzung wird `invited`. */
export async function issueBoardInvitation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const loaded = await loadMeeting(deps, input, boardInvitationSchema);
  if (!loaded.ok) return loaded;
  const meeting = loaded.value;
  const refused = refuse(deps.db, meeting);
  if (refused) return refused;
  const facts = invitationFactsInternal(deps.db, deps, meeting.id, 'invitation');
  const issuedOn = todayIn(deps);
  const recipients = organMembersOnInternal(deps.db, meeting.organId, meeting.heldOn);
  const issued = await issueGeneratedDocument(deps, ctx, {
    templateKey: INVITATION_TEMPLATE_KEY,
    input: facts,
    subject: facts.subject,
    documentDate: issuedOn,
    links: [{ entityType: 'governanceMeeting', entityId: meeting.id, role: 'about' }, ...recipients.map((contactId) => ({ entityType: 'contact', entityId: contactId, role: 'recipient' as const }))],
    afterIssue: (tx, doc) => {
      const again = refuse(tx, meetingRowInternal(tx, meeting.id)!);
      if (again) abortIssue(again);
      tx.update(governanceMeetings).set({ invitedOn: issuedOn, invitationDocumentId: doc.id, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, meeting.id)).run();
      recordAudit(tx, deps, ctx, { action: 'governance.boardInvitation.issue', entityType: 'governanceMeeting', entityId: meeting.id, after: { invitedOn: issuedOn, documentId: doc.id, recipients: recipients.length }, params: { heldOn: meeting.heldOn, documentNumber: doc.number } });
    },
  });
  if (!issued.ok) return issued;
  return ok(meetingView(deps.db, meetingRowInternal(deps.db, meeting.id)!));
}

/** Schickt die einfache Einladung per Mail an ihre Empfänger (nur ein Mensch; `governance.manage` und `dms.send`). */
export async function sendBoardInvitation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ queued: number; post: number }>> {
  const denied = requirePermission(ctx, 'governance.manage') ?? requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const loaded = await loadMeeting(deps, input, boardInvitationSchema);
  if (!loaded.ok) return loaded;
  const meeting = loaded.value;
  const documentId = meeting.invitationDocumentId;
  if (!documentId) return governanceConflict('invitationMissing');
  const notReady = mailNotReady(deps);
  if (notReady) return notReady;
  const items = deps.db
    .select({ contactId: documentLinks.entityId })
    .from(documentLinks)
    .where(and(eq(documentLinks.documentId, documentId), eq(documentLinks.entityType, 'contact'), eq(documentLinks.role, 'recipient')))
    .all()
    .map((l) => ({ documentId, contactId: l.contactId }));
  return deps.db.transaction((tx: DbOrTx) => {
    const { queued, skipped } = queueDocumentEmailsInternal(tx, deps, ctx, { items, runRef: `governanceMeeting:${meeting.id}` });
    recordAudit(tx, deps, ctx, { action: 'governance.boardInvitation.mail', entityType: 'governanceMeeting', entityId: meeting.id, after: { queued: queued.length }, params: { count: queued.length } });
    return ok({ queued: queued.length, post: skipped.length });
  });
}

/** Vermerk „eingeladen am … per …“ ohne Dokument (Messenger, Telefon); die Sitzung wird `invited`. Auch für Agenten. */
export async function recordInvitationNote(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, invitationNoteSchema, input);
  if (!parsed.ok) return parsed;
  const meeting = meetingRowInternal(deps.db, parsed.value.meetingId);
  if (!meeting) return notFound('governanceMeeting', parsed.value.meetingId);
  const refused = refuse(deps.db, meeting);
  if (refused) return refused;
  const { invitedOn, note } = parsed.value;
  if (invitedOn > todayIn(deps)) return invalid([{ path: 'invitedOn', message: 'inFuture' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceMeetings).set({ invitedOn, invitationNote: note, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, meeting.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.invitation.note', entityType: 'governanceMeeting', entityId: meeting.id, after: { invitedOn, note }, params: { invitedOn } });
    return ok(meetingView(tx, meetingRowInternal(tx, meeting.id)!));
  });
}
