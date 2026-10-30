import { invalid, notFound, ok, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { applyDispatchInternal, dmsMailOutbox, documents, mailNotReady, movePairToPostInternal, previewSend, queueDocumentEmailsInternal, readLinkedDocument, returnPairToEmailInternal, type MailOutboxStatus, type SendPlanItem, type SendPlanReason } from '@kompass/module-dms';
import { memberMemberships } from '@kompass/module-members';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from '../errors';
import { governanceInvitationRuns, governanceRunLetters, type InvitationRunRow } from '../schema';
import { HUMAN_ONLY_SETTING, RUN_REF_PREFIX } from './runs';

const id = z.string().min(1);
export const invitationDispatchSchema = z.object({ runId: id });
/** `documentIds`: nur diese Briefe (auch nicht eingereihte der Mail-Gruppe); ohne: alle offenen der Post-Gruppe. */
export const invitationMarkPostSchema = z.object({ runId: id, sentAt: z.iso.date(), documentIds: z.array(id).min(1).max(500).optional() });
export const invitationMoveSchema = z.object({ runId: id, documentIds: z.array(id).min(1).max(500), to: z.enum(['post', 'email']) });

interface LetterInfo {
  documentId: string;
  documentNumber: string | null;
  membershipId: string;
  memberNumber: string;
  /** Anzeigename des Kontakts (Plan U1). */
  name: string;
  sentAt: string | null;
}
export interface InvitationDispatchState {
  mail: (LetterInfo & { state: MailOutboxStatus | 'notQueued'; address: string; outboxId: string | null; errorCode: string | null; errorText: string | null })[];
  post: (LetterInfo & { reason: SendPlanReason; dispatched: boolean })[];
  /** Jeder Brief gesendet oder per Post vermerkt, und der Lauf stellt keine Briefe mehr aus. */
  done: boolean;
  mailState: { kind: 'off' | 'ready' | 'redirect' | 'blocked'; redirectTo: string | null };
}

const loadRun = (db: DbOrTx, runId: string): InvitationRunRow | undefined => db.select().from(governanceInvitationRuns).where(eq(governanceInvitationRuns.id, runId)).get();

/** Die nicht stornierten Briefe des Laufs, nach Mitgliedsnummer. */
function lettersOf(db: DbOrTx, runId: string) {
  return db
    .select({ documentId: governanceRunLetters.documentId, membershipId: governanceRunLetters.membershipId, contactId: governanceRunLetters.contactId, memberNumber: memberMemberships.memberNumber, number: documents.number, sentAt: documents.sentAt, status: documents.status })
    .from(governanceRunLetters)
    .innerJoin(memberMemberships, eq(memberMemberships.id, governanceRunLetters.membershipId))
    .innerJoin(documents, eq(documents.id, governanceRunLetters.documentId))
    .where(eq(governanceRunLetters.runId, runId))
    .orderBy(asc(memberMemberships.memberNumber), asc(governanceRunLetters.createdAt))
    .all()
    .filter((l) => l.status !== 'voided');
}

async function stateOf(deps: Deps, ctx: CallContext, run: InvitationRunRow): Promise<Result<Omit<InvitationDispatchState, 'mailState'> & { plan: SendPlanItem[]; letters: ReturnType<typeof lettersOf> }>> {
  const letters = lettersOf(deps.db, run.id);
  const plan: SendPlanItem[] = [];
  for (let i = 0; i < letters.length; i += 500) {
    const preview = await previewSend(deps, ctx, { documentIds: letters.slice(i, i + 500).map((l) => l.documentId) });
    if (!preview.ok) return preview;
    plan.push(...preview.value.items);
  }
  const byDoc = new Map(letters.map((l) => [l.documentId, l]));
  const contactIds = [...new Set(letters.map((l) => l.contactId))];
  const names = new Map(contactIds.length ? deps.db.select().from(contacts).where(inArray(contacts.id, contactIds)).all().map((c) => [c.id, displayName(c)]) : []);
  const info = (documentId: string): LetterInfo => {
    const l = byDoc.get(documentId)!;
    return { documentId, documentNumber: l.number, membershipId: l.membershipId, memberNumber: l.memberNumber ?? '', name: names.get(l.contactId) ?? '', sentAt: l.sentAt };
  };
  const mail: InvitationDispatchState['mail'] = [];
  const post: InvitationDispatchState['post'] = [];
  for (const item of plan) {
    if (item.channel === 'email') {
      // Der jüngste Eintrag im Ausgang (wie der Serienlauf der Mitglieder): für „Erneut senden“ und den Grund eines Fehlers.
      const entry = deps.db.select().from(dmsMailOutbox).where(and(eq(dmsMailOutbox.documentId, item.documentId), eq(dmsMailOutbox.contactId, item.contactId))).orderBy(desc(dmsMailOutbox.queuedAt), desc(dmsMailOutbox.id)).get();
      mail.push({ ...info(item.documentId), state: item.outboxStatus ?? 'notQueued', address: item.address, outboxId: entry?.id ?? null, errorCode: entry?.lastErrorCode ?? null, errorText: entry?.lastErrorText ?? null });
    }
    else post.push({ ...info(item.documentId), reason: item.reason, dispatched: byDoc.get(item.documentId)!.sentAt !== null });
  }
  const done = run.status === 'done' && mail.every((m) => m.state === 'sent' || m.sentAt !== null) && post.every((p) => p.dispatched);
  return ok({ mail, post, done, plan, letters });
}

async function runFor(deps: Deps, input: unknown, schema: z.ZodType<{ runId: string }>): Promise<Result<InvitationRunRow>> {
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const run = loadRun(deps.db, parsed.value.runId);
  return run ? ok(run) : notFound('governanceInvitationRun', parsed.value.runId);
}

/** Der Schritt „Versand“ eines Einladungslaufs: Mail-Gruppe mit Zustand, Post-Gruppe mit Grund und Vermerk. */
export async function invitationDispatchState(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<InvitationDispatchState>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const run = await runFor(deps, input, invitationDispatchSchema);
  if (!run.ok) return run;
  const state = await stateOf(deps, ctx, run.value);
  if (!state.ok) return state;
  const mailState = deps.mail.state();
  const { mail, post, done } = state.value;
  return ok({ mail, post, done, mailState: { kind: mailState.kind, redirectTo: mailState.kind === 'redirect' ? mailState.to : null } });
}

/** Reiht die Mail-Gruppe ein (nur ein Mensch; `governance.manage` und `dms.send`). Schon eingereihte oder vermerkte Briefe bleiben. */
export async function sendInvitationMails(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ queued: number; post: number }>> {
  const denied = requirePermission(ctx, 'governance.manage') ?? requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const run = await runFor(deps, input, invitationDispatchSchema);
  if (!run.ok) return run;
  const notReady = mailNotReady(deps);
  if (notReady) return notReady;
  const state = await stateOf(deps, ctx, run.value);
  if (!state.ok) return state;
  const sentAt = new Map(state.value.letters.map((l) => [l.documentId, l.sentAt]));
  const items = state.value.plan.flatMap((p) => (p.channel === 'email' && !p.outboxStatus && !sentAt.get(p.documentId) ? [{ documentId: p.documentId, contactId: p.contactId }] : []));
  return deps.db.transaction((tx: DbOrTx) => {
    const { queued, skipped } = queueDocumentEmailsInternal(tx, deps, ctx, { items, runRef: RUN_REF_PREFIX + run.value.id });
    recordAudit(tx, deps, ctx, { action: 'governance.invitation.mail', entityType: 'governanceInvitationRun', entityId: run.value.id, after: { queued: queued.length }, params: { count: queued.length } });
    return ok({ queued: queued.length, post: state.value.post.length + skipped.length });
  });
}

/** Die Post-Gruppe als ein PDF zum Drucken (liefert Bytes, kein MCP-Werkzeug). */
export async function printInvitationPdf(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ fileName: string; bytes: Uint8Array; count: number }>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const run = await runFor(deps, input, invitationDispatchSchema);
  if (!run.ok) return run;
  const state = await stateOf(deps, ctx, run.value);
  if (!state.ok) return state;
  if (state.value.post.length === 0) return governanceConflict('runNothingToPrint');
  const files: Uint8Array[] = [];
  for (const row of state.value.post) {
    const copy = await readLinkedDocument(deps, ctx, { documentId: row.documentId, entityType: 'governanceMeeting', entityId: run.value.meetingId });
    if (!copy.ok) return copy;
    files.push(copy.value.bytes);
  }
  const bytes = files.length === 1 ? files[0]! : await deps.pdf.merge(files);
  return ok({ fileName: 'Einladungen-Post.pdf', bytes, count: files.length });
}

/** „Versand vermerken“: Weg `post` an den offenen Briefen der Post-Gruppe oder an den genannten. */
export async function markInvitationPostDispatched(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ count: number }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, invitationMarkPostSchema, input);
  if (!parsed.ok) return parsed;
  const { runId, sentAt, documentIds } = parsed.value;
  const run = loadRun(deps.db, runId);
  if (!run) return notFound('governanceInvitationRun', runId);
  if (sentAt > todayIn(deps)) return invalid([{ path: 'sentAt', message: 'sentInFuture' }]);
  const state = await stateOf(deps, ctx, run);
  if (!state.ok) return state;
  const asked = (docId: string) => !documentIds || documentIds.includes(docId);
  const mailAsked = documentIds ? state.value.mail.filter((m) => documentIds.includes(m.documentId) && m.state !== 'sent' && m.sentAt === null) : [];
  if (mailAsked.some((m) => m.state === 'queued' || m.state === 'sending')) return governanceConflict('runLetterQueued');
  const open = [...state.value.post.filter((p) => !p.dispatched && asked(p.documentId)).map((p) => p.documentId), ...mailAsked.map((m) => m.documentId)];
  if (open.length === 0) return governanceConflict('runNothingToDispatch');
  return deps.db.transaction((tx: DbOrTx) => {
    const rows = tx.select().from(documents).where(inArray(documents.id, open)).all();
    if (rows.some((r) => sentAt < r.documentDate)) return invalid([{ path: 'sentAt', message: 'sentBeforeDocumentDate' }]);
    for (const row of rows) applyDispatchInternal(tx, deps, ctx, row, { sentAt, sentVia: 'post', note: null });
    recordAudit(tx, deps, ctx, { action: 'governance.invitation.markPost', entityType: 'governanceInvitationRun', entityId: runId, after: { count: rows.length, sentAt }, params: { count: rows.length, sentOn: sentAt } });
    return ok({ count: rows.length });
  });
}

class MoveAborted extends Error {
  constructor(readonly failure: Failure) {
    super('invitation move aborted');
  }
}

/** „Per Post schicken“ / „Zurück zu E-Mail“ je Brief — alle oder keiner. */
export async function moveInvitationLetters(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ count: number }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, invitationMoveSchema, input);
  if (!parsed.ok) return parsed;
  const { runId, documentIds, to } = parsed.value;
  const run = loadRun(deps.db, runId);
  if (!run) return notFound('governanceInvitationRun', runId);
  const letters = new Map(lettersOf(deps.db, runId).map((l) => [l.documentId, l]));
  const missing = documentIds.find((d) => !letters.has(d));
  if (missing) return notFound('document', missing);
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      for (const documentId of documentIds) {
        const pair = { documentId, contactId: letters.get(documentId)!.contactId, runRef: RUN_REF_PREFIX + runId };
        const moved = to === 'post' ? movePairToPostInternal(tx, deps, ctx, pair) : returnPairToEmailInternal(tx, deps, ctx, pair);
        if (!moved.ok) throw new MoveAborted(moved);
      }
      const entry = { entityType: 'governanceInvitationRun', entityId: runId, after: { count: documentIds.length }, params: { count: documentIds.length } };
      if (to === 'post') recordAudit(tx, deps, ctx, { action: 'governance.invitation.toPost', ...entry });
      else recordAudit(tx, deps, ctx, { action: 'governance.invitation.toEmail', ...entry });
      return ok({ count: documentIds.length });
    });
  } catch (error) {
    if (error instanceof MoveAborted) return error.failure;
    throw error;
  }
}
