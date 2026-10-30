import { isoNow, newId, notFound, ok, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { deliveryForContactInternal } from '@kompass/module-contacts';
import { abortIssue, issueGeneratedDocument } from '@kompass/module-dms';
import { letterRecipientOf, memberMemberships, membershipViews, recipientFacts, type MembershipView } from '@kompass/module-members';
import { eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { noticeDeadlineInternal } from '../deadlines/notice';
import { governanceConflict } from '../errors';
import { meetingRowInternal, meetingStateOf } from '../meetings';
import { governanceInvitationRuns, governanceMeetings, governanceOrgans, governanceRunLetters, INVITATION_RUN_KINDS, type InvitationRunKind, type InvitationRunRow, type MeetingRow } from '../schema';
import { invitationFactsInternal } from './facts';
import { CANCELLATION_LETTER_TEMPLATE_KEY, INVITATION_LETTER_TEMPLATE_KEY, INVITATION_TEMPLATE_KEY } from './template';

export const HUMAN_ONLY_SETTING = 'governance.mcpHumanOnlyAllowed';
/** `runRef` des Versands in der Akte: `governanceInvitationRun:<id>`. */
export const RUN_REF_PREFIX = 'governanceInvitationRun:';

/** `motionsByPassed`: die Antragsfrist, die der Brief nennt, ist am Ausstelltag schon vorbei (W-14). */
export type InvitationRunWarning = 'noticeShort' | 'noticeBelowLawHint' | 'motionsByPassed';
export interface InvitationRunPreview {
  meetingId: string;
  kind: InvitationRunKind;
  recipients: { membershipId: string; memberNumber: string; contactId: string; hasVotingRight: boolean; channel: 'email' | 'post'; refusal: 'addressMissing' | null }[];
  warnings: InvitationRunWarning[];
}
export type InvitationRunView = InvitationRunRow & { pending: number; issued: number };

const id = z.string().min(1);
export const invitationRunSchema = z.object({ meetingId: id, kind: z.enum(INVITATION_RUN_KINDS) });
export const invitationRunContinueSchema = z.object({ runId: id, max: z.number().int().min(1).max(50).default(10) });
export const invitationRunIdSchema = z.object({ runId: id });

/**
 * Empfänger eines Laufs: jede Mitgliedschaft, die am Tag läuft (`active`, `ending`), mit und ohne Stimmrecht —
 * Fördermitglieder sind teilnahme- und antragsberechtigt (Spec § 5.3). Nach Mitgliedsnummer.
 */
export function invitationRecipientsInternal(db: DbOrTx, deps: Deps, on: string): MembershipView[] {
  const rows = db.select().from(memberMemberships).where(isNotNull(memberMemberships.memberNumber)).all().filter((r) => !r.joinedOn || r.joinedOn <= on);
  return membershipViews(db, deps, rows, on)
    .filter((v) => v.status === 'active' || v.status === 'ending')
    .sort((a, b) => (a.memberNumber ?? '').localeCompare(b.memberNumber ?? '') || a.id.localeCompare(b.id));
}

/** Läufe gibt es nur für die Mitgliederversammlung, nicht für die Gründung (Vorstand: einfache Einladung). */
function refuseOrgan(db: DbOrTx, meeting: MeetingRow): Failure | null {
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get();
  return organ?.kind !== 'assembly' || meeting.kind === 'founding' ? governanceConflict('runNotForOrgan') : null;
}

const runsOf = (db: DbOrTx, meetingId: string) => db.select().from(governanceInvitationRuns).where(eq(governanceInvitationRuns.meetingId, meetingId)).all();
const lettersOf = (db: DbOrTx, runId: string) => db.select().from(governanceRunLetters).where(eq(governanceRunLetters.runId, runId)).all();

function refuseKind(db: DbOrTx, meeting: MeetingRow, kind: InvitationRunKind): Failure | null {
  const runs = runsOf(db, meeting.id);
  const invitation = runs.find((r) => r.kind === 'invitation');
  const state = meetingStateOf(meeting);
  if (kind === 'cancellation') return state === 'cancelled' && invitation && lettersOf(db, invitation.id).length > 0 ? null : governanceConflict('cancellationWithoutLetters');
  if (state === 'cancelled') return governanceConflict('meetingCancelled');
  if (state !== 'planned' && state !== 'invited') return governanceConflict('meetingStarted');
  if (kind === 'invitation') return invitation ? governanceConflict('invitationExists') : null;
  return invitation?.status === 'done' ? null : governanceConflict('invitationNotDone');
}

function previewOf(db: DbOrTx, deps: Deps, meeting: MeetingRow, kind: InvitationRunKind): InvitationRunPreview {
  const today = todayIn(deps);
  const recipients = invitationRecipientsInternal(db, deps, today).map((m) => {
    const contactId = letterRecipientOf(m, today);
    return { membershipId: m.id, memberNumber: m.memberNumber ?? '', contactId, hasVotingRight: m.hasVotingRight, channel: deliveryForContactInternal(db, contactId).channel, refusal: recipientFacts(db, contactId).ok ? null : ('addressMissing' as const) };
  });
  const warnings: InvitationRunWarning[] = [];
  if (kind !== 'cancellation') {
    const deadline = noticeDeadlineInternal(db, meeting.organId, meeting.heldOn);
    if (deadline.lastReceiptDay === null) {
      if (today > deadline.lawHintDay) warnings.push('noticeBelowLawHint');
    } else {
      const byPost = recipients.some((r) => r.refusal === null && r.channel === 'post');
      const limit = byPost ? deadline.sendBy.post : deadline.sendBy.email;
      if (limit !== null && today > limit) warnings.push('noticeShort');
    }
    if (deadline.motionsBy && today > deadline.motionsBy) warnings.push('motionsByPassed');
  }
  return { meetingId: meeting.id, kind, recipients, warnings };
}

function runView(db: DbOrTx, deps: Deps, run: InvitationRunRow): InvitationRunView {
  const letters = lettersOf(db, run.id);
  const handled = new Set([...letters.map((l) => l.membershipId), ...run.refused.map((r) => r.membershipId)]);
  const pending = run.status === 'done' ? 0 : invitationRecipientsInternal(db, deps, run.issuedOn).filter((m) => !handled.has(m.id)).length;
  return { ...run, pending, issued: letters.length };
}

/** Vorschau des Laufs: Empfänger mit Weg und Grund, Hinweise zur Frist. Nur lesen. */
export async function previewInvitationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<InvitationRunPreview>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, invitationRunSchema, input);
  if (!parsed.ok) return parsed;
  const meeting = meetingRowInternal(deps.db, parsed.value.meetingId);
  if (!meeting) return notFound('governanceMeeting', parsed.value.meetingId);
  const organ = refuseOrgan(deps.db, meeting);
  if (organ) return organ;
  return ok(previewOf(deps.db, deps, meeting, parsed.value.kind));
}

/**
 * Lauf starten (nur ein Mensch): stellt das Hauptdokument `ELD` aus und legt den Lauf an; bei der Einladung wird die
 * Sitzung in derselben Transaktion `invited`. Eine unterschrittene Frist ist ein Hinweis, keine Sperre.
 */
export async function startInvitationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<InvitationRunView & { warnings: InvitationRunWarning[] }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, invitationRunSchema, input);
  if (!parsed.ok) return parsed;
  const { meetingId, kind } = parsed.value;
  const meeting = meetingRowInternal(deps.db, meetingId);
  if (!meeting) return notFound('governanceMeeting', meetingId);
  const refused = refuseOrgan(deps.db, meeting) ?? refuseKind(deps.db, meeting, kind);
  if (refused) return refused;
  const warnings = previewOf(deps.db, deps, meeting, kind).warnings;
  const facts = invitationFactsInternal(deps.db, deps, meetingId, kind);
  const issuedOn = todayIn(deps);
  const issued = await issueGeneratedDocument(deps, ctx, {
    templateKey: INVITATION_TEMPLATE_KEY,
    input: facts,
    subject: facts.subject,
    documentDate: issuedOn,
    links: [{ entityType: 'governanceMeeting', entityId: meetingId, role: 'about' }],
    afterIssue: (tx, doc) => {
      const again = refuseKind(tx, meetingRowInternal(tx, meetingId)!, kind);
      if (again) abortIssue(again);
      const run: InvitationRunRow = { id: newId(), meetingId, kind, status: 'running', issuedOn, masterDocumentId: doc.id, refused: [], createdByUserId: ctx.userId ?? null, createdAt: isoNow(deps.clock), finishedAt: null };
      tx.insert(governanceInvitationRuns).values(run).run();
      if (kind === 'invitation') tx.update(governanceMeetings).set({ invitedOn: issuedOn, invitationDocumentId: doc.id, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, meetingId)).run();
      recordAudit(tx, deps, ctx, { action: 'governance.invitationRun.start', entityType: 'governanceInvitationRun', entityId: run.id, after: { meetingId, kind, documentId: doc.id }, params: { kind, meetingId, documentNumber: doc.number } });
      return run;
    },
  });
  if (!issued.ok) return issued;
  return ok({ ...runView(deps.db, deps, issued.value.after!), warnings });
}

/**
 * Lauf fortsetzen (nur ein Mensch): höchstens `max` Briefe, je in eigener Transaktion, an das Mitglied oder seine
 * gesetzliche Vertretung. Fehlen Anschrift und E-Mail, steht die Mitgliedschaft unter `refused`; der Lauf läuft weiter.
 * Fertig, wenn keine Mitgliedschaft mehr offen ist.
 */
export async function continueInvitationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<InvitationRunView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, invitationRunContinueSchema, input);
  if (!parsed.ok) return parsed;
  const run = deps.db.select().from(governanceInvitationRuns).where(eq(governanceInvitationRuns.id, parsed.value.runId)).get();
  if (!run) return notFound('governanceInvitationRun', parsed.value.runId);
  if (run.status !== 'running') return governanceConflict('invitationRunDone');
  const handled = new Set([...lettersOf(deps.db, run.id).map((l) => l.membershipId), ...run.refused.map((r) => r.membershipId)]);
  const open = invitationRecipientsInternal(deps.db, deps, run.issuedOn).filter((m) => !handled.has(m.id));
  const base = invitationFactsInternal(deps.db, deps, run.meetingId, run.kind);
  const templateKey = run.kind === 'cancellation' ? CANCELLATION_LETTER_TEMPLATE_KEY : INVITATION_LETTER_TEMPLATE_KEY;
  const refusedNow: { membershipId: string; code: string }[] = [];
  let issuedNow = 0;
  for (const membership of open.slice(0, parsed.value.max)) {
    const contactId = letterRecipientOf(membership, run.issuedOn);
    const recipient = recipientFacts(deps.db, contactId);
    if (!recipient.ok) {
      refusedNow.push({ membershipId: membership.id, code: codeOf(recipient) });
      continue;
    }
    const letter = await issueGeneratedDocument(deps, ctx, {
      templateKey,
      input: { ...base, recipient: recipient.value.recipient, greeting: recipient.value.greeting },
      subject: base.subject,
      documentDate: todayIn(deps),
      links: [
        { entityType: 'governanceMeeting', entityId: run.meetingId, role: 'about' },
        { entityType: 'membership', entityId: membership.id, role: 'about' },
        { entityType: 'contact', entityId: contactId, role: 'recipient' },
      ],
      afterIssue: (tx, doc) => {
        tx.insert(governanceRunLetters).values({ id: newId(), runId: run.id, membershipId: membership.id, contactId, documentId: doc.id, createdAt: isoNow(deps.clock) }).run();
        recordAudit(tx, deps, ctx, { action: 'governance.invitation.letter', entityType: 'governanceInvitationRun', entityId: run.id, after: { membershipId: membership.id, documentId: doc.id }, params: { documentNumber: doc.number } });
      },
    });
    if (letter.ok) issuedNow += 1;
    else refusedNow.push({ membershipId: membership.id, code: codeOf(letter) });
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const refused = [...run.refused, ...refusedNow];
    const finished = open.length <= parsed.value.max;
    const next: InvitationRunRow = { ...run, refused, ...(finished ? { status: 'done' as const, finishedAt: isoNow(deps.clock) } : {}) };
    tx.update(governanceInvitationRuns).set({ refused, status: next.status, finishedAt: next.finishedAt }).where(eq(governanceInvitationRuns.id, run.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.invitationRun.continue', entityType: 'governanceInvitationRun', entityId: run.id, after: { issued: issuedNow, refused: refusedNow.length, status: next.status }, params: { issued: issuedNow, refused: refusedNow.length } });
    return ok(runView(tx, deps, next));
  });
}

export async function getInvitationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<InvitationRunView>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, invitationRunIdSchema, input);
  if (!parsed.ok) return parsed;
  const run = deps.db.select().from(governanceInvitationRuns).where(eq(governanceInvitationRuns.id, parsed.value.runId)).get();
  return run ? ok(runView(deps.db, deps, run)) : notFound('governanceInvitationRun', parsed.value.runId);
}

/** Die Läufe einer Sitzung, ältester zuerst. */
export function invitationRunsInternal(db: DbOrTx, deps: Deps, meetingId: string): InvitationRunView[] {
  return runsOf(db, meetingId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((r) => runView(db, deps, r));
}

const codeOf = (failure: Failure): string => ('code' in failure.error && typeof failure.error.code === 'string' ? failure.error.code : failure.error.type);
