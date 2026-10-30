import {
  isoNow,
  localizedConflict,
  newId,
  notFound,
  ok,
  readSetting,
  recordAudit,
  requireHumanChannel,
  requirePermission,
  schema as coreSchema,
  todayIn,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Failure,
  type MailState,
  type Result,
  type SystemMailHook,
} from '@kompass/core';
import { contacts, deliveryForContactInternal, displayName } from '@kompass/module-contacts';
import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { requireAreaAccess } from '../access';
import { dmsMailOutbox, dmsMailPostMoves, documentLinks, documents, MAIL_OUTBOX_STATUSES, type DmsMailOutboxRow, type DmsMailPostMoveRow, type DocumentRow, type MailOutboxStatus } from '../schema';
import { DOCUMENT_MAX_BYTES } from '../storage';
import { TEST_MAIL_TEXTS } from './defaults';
import { fillMailPlaceholders, mailBodyFor, mailBodySnippetFor } from './body';

/** Schalter, mit dem ein Verein Agenten das Senden erlaubt (nur am Bildschirm änderbar). */
export const DMS_HUMAN_ONLY_SETTING = 'dms.mcpHumanOnlyAllowed';

export type SendPlanReason =
  | 'preference'
  | 'noEmail'
  | 'mailOff'
  | 'notFinal'
  | 'voided'
  | 'notOutgoing'
  | 'tooLarge'
  | 'noRecipient'
  /** Von Hand in die Post-Gruppe verschoben („Per Post schicken“, Plan U4 Task 2). */
  | 'manual'
  | 'notMachineProcedure';

export type SendPlanItem =
  | {
      documentId: string;
      contactId: string;
      channel: 'email';
      address: string;
      /** Eigene Adresse oder die der Organisation (Spec § 4.1, „Person bei einer Organisation“). */
      via: 'self' | 'organization';
      /** Steht das Paar schon im Ausgang, sein Zustand. */
      outboxStatus?: MailOutboxStatus;
    }
  | { documentId: string; contactId: string | null; channel: 'post'; reason: SendPlanReason };

/** Was schon im Ausgang steht, wird kein zweites Mal eingereiht; nur „Erneut senden“ legt eine neue Sendung an. */
const ACTIVE_STATUSES: readonly MailOutboxStatus[] = ['queued', 'sending', 'sent', 'failed', 'blocked'];

const documentIdsSchema = z.object({ documentIds: z.array(z.string().min(1)).min(1).max(500) });
/** `contactIds`: nur an diese Empfänger (Dialog am Dokument, Auswahl bei mehreren Bezügen); ohne: an alle. */
const sendDocumentsSchema = documentIdsSchema.extend({ contactIds: z.array(z.string().min(1)).min(1).max(50).optional() });
const documentIdSchema = z.object({ documentId: z.string().min(1) });
const outboxIdSchema = z.object({ outboxId: z.string().min(1) });
const outboxIdsSchema = z.object({ outboxIds: z.array(z.string().min(1)).min(1).max(500) });
export const outboxListSchema = z.object({
  status: z.enum(MAIL_OUTBOX_STATUSES).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Nur die letzten n Tage, heute eingeschlossen (Filter „Zeitraum“ des Ausgangs). */
  days: z.number().int().min(1).max(3660).optional(),
  /** Nur die Sendungen eines Dokuments (Karte „Versand“ am Dokument). */
  documentId: z.string().min(1).optional(),
  /** Nur die Sendungen eines Laufs (`membersFeeRun:…`, `financeConfirmationRun:…`) — Versand-Schritt der Läufe. */
  runRef: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export { sendDocumentsSchema, documentIdsSchema as previewSendSchema, documentIdSchema as mailDraftSchema, outboxIdSchema as resendSchema, outboxIdsSchema as outboxIdsSchema };

function dmsConflict(code: string, params: Record<string, string | number> = {}): Failure {
  return localizedConflict(code, `dms.errors.${code}`, params);
}

/**
 * Kann die Installation überhaupt senden? `blocked` heißt: Testumgebung ohne
 * Umleitung. Auch für Läufe anderer Module, bevor sie einreihen.
 */
export function mailNotReady(deps: Deps): Failure | null {
  const state = deps.mail.state();
  if (state.kind === 'off' || state.kind === 'blocked') return dmsConflict('mailNotReady', { state: state.kind });
  if (!readSetting<string | null>(deps, 'dms.mail.fromAddress')) return dmsConflict('mailNoSender');
  return null;
}

function latestEntry(db: DbOrTx, documentId: string, contactId: string): DmsMailOutboxRow | undefined {
  return db
    .select()
    .from(dmsMailOutbox)
    .where(and(eq(dmsMailOutbox.documentId, documentId), eq(dmsMailOutbox.contactId, contactId)))
    .orderBy(desc(dmsMailOutbox.queuedAt), desc(dmsMailOutbox.id))
    .get();
}

function latestMove(db: DbOrTx, documentId: string, contactId: string): DmsMailPostMoveRow | undefined {
  return db
    .select()
    .from(dmsMailPostMoves)
    .where(and(eq(dmsMailPostMoves.documentId, documentId), eq(dmsMailPostMoves.contactId, contactId)))
    .orderBy(desc(dmsMailPostMoves.movedAt), desc(dmsMailPostMoves.id))
    .get();
}

/**
 * Von Hand verschoben (Plan U4 Task 2): `post`, solange ein Verschieben gilt — oder eine zurückgezogene Sendung ohne
 * späteres „Zurück zu E-Mail“ im Ausgang steht (Altbestand und „Per Post schicken“ am Ausgang). `returned`, wenn die
 * zurückgezogene Sendung danach zurückgeholt wurde: Das Paar ist dann wieder offen, als wäre es nie eingereiht.
 */
export function manualChannelInternal(db: DbOrTx, documentId: string, contactId: string, existing: DmsMailOutboxRow | undefined = latestEntry(db, documentId, contactId)): 'post' | 'returned' | null {
  const move = latestMove(db, documentId, contactId);
  if (move && !move.returnedAt) return 'post';
  if (existing?.status !== 'withdrawn') return null;
  return move?.returnedAt && move.returnedAt >= existing.queuedAt ? 'returned' : 'post';
}

/** Ein Grund am Dokument selbst, der jeden Empfänger trifft. */
function documentReason(row: DocumentRow): SendPlanReason | null {
  if (row.phase !== 'issued' || !row.fileName) return 'notFinal';
  if (row.status === 'voided') return 'voided';
  if (row.direction !== 'outgoing') return 'notOutgoing';
  if ((row.fileBytes ?? 0) > DOCUMENT_MAX_BYTES) return 'tooLarge';
  return null;
}

/** Der Weg eines Briefs an einen Empfänger — ohne zu schreiben. */
function planPair(db: DbOrTx, deps: Deps, row: DocumentRow, contactId: string): SendPlanItem {
  const reason = documentReason(row);
  if (reason) return { documentId: row.id, contactId, channel: 'post', reason };
  if (deps.mail.state().kind === 'off') return { documentId: row.id, contactId, channel: 'post', reason: 'mailOff' };
  const delivery = deliveryForContactInternal(db, contactId);
  if (delivery.channel === 'post') return { documentId: row.id, contactId, channel: 'post', reason: delivery.reason };
  const existing = latestEntry(db, row.id, contactId);
  const manual = manualChannelInternal(db, row.id, contactId, existing);
  if (manual === 'post') return { documentId: row.id, contactId, channel: 'post', reason: 'manual' };
  return { documentId: row.id, contactId, channel: 'email', address: delivery.address, via: delivery.via, ...(existing && manual !== 'returned' ? { outboxStatus: existing.status } : {}) };
}

function recipientsOf(db: DbOrTx, documentId: string): string[] {
  return db
    .select({ id: documentLinks.entityId })
    .from(documentLinks)
    .where(and(eq(documentLinks.documentId, documentId), eq(documentLinks.entityType, 'contact'), eq(documentLinks.role, 'recipient')))
    .all()
    .map((l) => l.id);
}

/** Der Plan für eine Liste von Dokumenten: je Empfänger ein Eintrag, ohne Empfänger einer mit `noRecipient`. */
function planDocuments(deps: Deps, ctx: CallContext, documentIds: string[], db: DbOrTx = deps.db): Result<SendPlanItem[]> {
  const items: SendPlanItem[] = [];
  for (const id of documentIds) {
    const row = db.select().from(documents).where(eq(documents.id, id)).get();
    if (!row) return notFound('document', id);
    const unreadable = requireAreaAccess(deps, ctx, row, db);
    if (unreadable) return unreadable;
    const reason = documentReason(row);
    const recipients = recipientsOf(db, row.id);
    // M26: Ein Entwurf oder ein storniertes Dokument nennt diesen Grund, auch ohne Empfänger.
    if (reason === 'notFinal' || reason === 'voided') {
      items.push({ documentId: row.id, contactId: recipients[0] ?? null, channel: 'post', reason });
      continue;
    }
    if (recipients.length === 0) {
      items.push({ documentId: row.id, contactId: null, channel: 'post', reason: 'noRecipient' });
      continue;
    }
    for (const contactId of recipients) items.push(planPair(db, deps, row, contactId));
  }
  return ok(items);
}

/** Vorschau: je Dokument Empfänger, Weg und Grund, dazu der Zustand des Versands. `dms.view`. */
export async function previewSend(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: SendPlanItem[]; mail: MailState }>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, documentIdsSchema, input);
  if (!parsed.ok) return parsed;
  const planned = planDocuments(deps, ctx, parsed.value.documentIds);
  if (!planned.ok) return planned;
  return ok({ items: planned.value, mail: deps.mail.state() });
}

function documentNumber(row: Pick<DocumentRow, 'number'>): string {
  return row.number ?? '';
}

function insertEntry(tx: DbOrTx, deps: Deps, ctx: CallContext, row: DocumentRow, contactId: string, address: string, runRef: string | null): string {
  const id = newId();
  tx.insert(dmsMailOutbox)
    .values({
      id,
      documentId: row.id,
      contactId,
      toAddress: address,
      subject: row.subject,
      bodySnippetId: mailBodySnippetFor(deps, row.typeKey, tx).id,
      status: 'queued',
      attempts: 0,
      queuedByUserId: ctx.userId,
      queuedAt: isoNow(deps.clock),
      runRef,
    })
    .run();
  return id;
}

/**
 * Für Läufe anderer Module, in deren Transaktion (Spec § 5): prüft je Paar wie
 * die Vorschau und reiht die Paare mit Weg E-Mail ein. Schon eingereihte oder
 * gesendete Paare werden übersprungen, ohne in `skipped` zu stehen; dort steht
 * nur, was als Post hinausgeht. Ein gesperrter Versand (Testumgebung ohne
 * Umleitung) reiht trotzdem ein — die Sendung bleibt dann im Ausgang stehen.
 * Rechte prüft der Aufrufer.
 */
export function queueDocumentEmailsInternal(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  input: { items: { documentId: string; contactId: string }[]; runRef?: string },
): { queued: string[]; skipped: SendPlanItem[] } {
  const queued: string[] = [];
  const skipped: SendPlanItem[] = [];
  for (const item of input.items) {
    const row = tx.select().from(documents).where(eq(documents.id, item.documentId)).get();
    if (!row) throw new Error(`document not found: ${item.documentId}`);
    const plan = planPair(tx, deps, row, item.contactId);
    if (plan.channel === 'post') {
      skipped.push(plan);
      continue;
    }
    if (plan.outboxStatus && ACTIVE_STATUSES.includes(plan.outboxStatus)) continue;
    const id = insertEntry(tx, deps, ctx, row, item.contactId, plan.address, input.runRef ?? null);
    recordAudit(tx, deps, ctx, {
      action: 'dms.mail.queue',
      entityType: 'document',
      entityId: row.id,
      after: { outboxId: id, status: 'queued' },
      params: { documentNumber: documentNumber(row) },
    });
    queued.push(id);
  }
  return { queued, skipped };
}

/**
 * Reiht alle Briefe mit Weg E-Mail ein und nennt die übrigen als Post.
 * `dms.send`, nur ein Mensch. Der Versand selbst läuft im Hintergrund; der
 * Versandvermerk entsteht erst, wenn der Mailserver die Mail angenommen hat.
 */
export async function sendDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ queued: number; post: SendPlanItem[] }>> {
  const denied = requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, DMS_HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, sendDocumentsSchema, input);
  if (!parsed.ok) return parsed;
  const notReady = mailNotReady(deps);
  if (notReady) return notReady;
  const planned = planDocuments(deps, ctx, parsed.value.documentIds);
  if (!planned.ok) return planned;
  const only = parsed.value.contactIds;
  if (only) planned.value.splice(0, planned.value.length, ...planned.value.filter((item) => item.contactId !== null && only.includes(item.contactId)));
  const post = planned.value.filter((item) => item.channel === 'post');
  const pairs = planned.value.filter((item) => item.channel === 'email').map((item) => ({ documentId: item.documentId, contactId: item.contactId! }));
  return deps.db.transaction((tx: DbOrTx) => {
    const { queued } = queueDocumentEmailsInternal(tx, deps, ctx, { items: pairs });
    return ok({ queued: queued.length, post });
  });
}

/** Eine neue Sendung für dasselbe Paar, an die heutige Adresse des Kontakts. Die alte bleibt, wie sie ist. */
function resendEntry(tx: DbOrTx, deps: Deps, ctx: CallContext, entry: DmsMailOutboxRow): Result<{ id: string }> {
  if (entry.status !== 'failed' && entry.status !== 'sent') return dmsConflict('mailNotResendable', { status: entry.status });
  const row = tx.select().from(documents).where(eq(documents.id, entry.documentId)).get();
  if (!row) return notFound('document', entry.documentId);
  // App-B2: Wartet zum selben Dokument und Empfänger schon eine Sendung, entsteht keine zweite (Doppelklick).
  const waiting = tx.select({ id: dmsMailOutbox.id }).from(dmsMailOutbox).where(and(eq(dmsMailOutbox.documentId, entry.documentId), eq(dmsMailOutbox.contactId, entry.contactId), inArray(dmsMailOutbox.status, ['queued', 'sending']))).get();
  if (waiting) return dmsConflict('alreadyQueued');
  const plan = planPair(tx, deps, row, entry.contactId);
  if (plan.channel === 'post') return dmsConflict('mailRecipientPost', { reason: plan.reason });
  const id = insertEntry(tx, deps, ctx, row, entry.contactId, plan.address, entry.runRef);
  recordAudit(tx, deps, ctx, {
    action: 'dms.mail.resend',
    entityType: 'document',
    entityId: row.id,
    before: { outboxId: entry.id, status: entry.status },
    after: { outboxId: id, status: 'queued' },
    params: { documentNumber: documentNumber(row) },
  });
  return ok({ id });
}

function loadEntries(deps: Deps, ctx: CallContext, ids: string[]): Result<DmsMailOutboxRow[]> {
  const rows = deps.db.select().from(dmsMailOutbox).where(inArray(dmsMailOutbox.id, ids)).all();
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) return notFound('mailOutbox', id);
    const doc = deps.db.select().from(documents).where(eq(documents.id, row.documentId)).get();
    if (doc) {
      const unreadable = requireAreaAccess(deps, ctx, doc);
      if (unreadable) return unreadable;
    }
  }
  return ok(ids.map((id) => rows.find((r) => r.id === id)!));
}

/** „Erneut senden“ für eine Sendung. `dms.send`, nur ein Mensch. */
export async function resendDocumentEmail(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, DMS_HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, outboxIdSchema, input);
  if (!parsed.ok) return parsed;
  const notReady = mailNotReady(deps);
  if (notReady) return notReady;
  const loaded = loadEntries(deps, ctx, [parsed.value.outboxId]);
  if (!loaded.ok) return loaded;
  return deps.db.transaction((tx: DbOrTx) => resendEntry(tx, deps, ctx, loaded.value[0]!));
}

/** „Erneut senden“ für mehrere nicht zugestellte Sendungen, alle oder keine. `dms.send`, nur ein Mensch. */
export async function retryFailedEmails(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ queued: string[] }>> {
  const denied = requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, DMS_HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, outboxIdsSchema, input);
  if (!parsed.ok) return parsed;
  const notReady = mailNotReady(deps);
  if (notReady) return notReady;
  const loaded = loadEntries(deps, ctx, parsed.value.outboxIds);
  if (!loaded.ok) return loaded;
  const notFailed = loaded.value.find((e) => e.status !== 'failed');
  if (notFailed) return dmsConflict('mailNotResendable', { status: notFailed.status });
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const queued: string[] = [];
      for (const entry of loaded.value) {
        const result = resendEntry(tx, deps, ctx, entry);
        if (!result.ok) throw new RetryAbort(result);
        queued.push(result.value.id);
      }
      return ok({ queued });
    });
  } catch (error) {
    if (error instanceof RetryAbort) return error.failure;
    throw error;
  }
}

class RetryAbort extends Error {
  constructor(readonly failure: Failure) {
    super('retry aborted');
  }
}

/**
 * Ein Paar des Versand-Schritts. `dispatched`: Der Aufrufer führt den Versandvermerk selbst (Zuwendungsbestätigungen
 * am Datensatz der Finanzen) — die Akte kennt dann nur ihren eigenen am Dokument.
 */
export interface PairMoveInput {
  documentId: string;
  contactId: string;
  runRef: string | null;
  dispatched?: boolean;
  /**
   * U7 (Plan N3): Steht die Zeile im Versandplan des Laufs schon in der Post-Gruppe (etwa eine Bestätigung, die nicht
   * maschinell erstellt ist), nennt die Ablehnung diesen Grund statt des Grunds der Akte.
   */
  planReason?: SendPlanReason;
}

function insertMove(tx: DbOrTx, deps: Deps, ctx: CallContext, documentId: string, contactId: string, runRef: string | null): void {
  tx.insert(dmsMailPostMoves).values({ id: newId(), documentId, contactId, runRef, movedAt: isoNow(deps.clock), movedByUserId: ctx.userId }).run();
}

/**
 * „Per Post schicken“ je Zeile (Nachtrag MCP-Test § 2, Plan U4 Task 2), in der Transaktion des Aufrufers — Rechte und
 * Zugehörigkeit zum Lauf prüft er. Erlaubt, solange der Brief per E-Mail ginge, nicht unterwegs oder gesendet ist und
 * keinen Versandvermerk trägt; eine wartende, gesperrte oder nicht zugestellte Sendung wird zurückgezogen. Danach
 * steht das Paar in der Post-Gruppe mit Grund `manual`. Protokoll `dms.mail.toPost` je Brief.
 */
export function movePairToPostInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: PairMoveInput): Result<void> {
  const row = tx.select().from(documents).where(eq(documents.id, input.documentId)).get();
  if (!row) return notFound('document', input.documentId);
  if (input.planReason) return dmsConflict('mailRecipientPost', { reason: input.planReason });
  const plan = planPair(tx, deps, row, input.contactId);
  if (plan.channel === 'post') return dmsConflict('mailRecipientPost', { reason: plan.reason });
  if (plan.outboxStatus === 'sending' || plan.outboxStatus === 'sent') return dmsConflict('mailNotPending', { status: plan.outboxStatus });
  if (row.sentAt || input.dispatched) return dmsConflict('mailAlreadyDispatched');
  const entry = plan.outboxStatus ? latestEntry(tx, row.id, input.contactId) : undefined;
  if (entry) {
    const changed = tx
      .update(dmsMailOutbox)
      .set({ status: 'withdrawn', nextAttemptAt: null })
      .where(and(eq(dmsMailOutbox.id, entry.id), inArray(dmsMailOutbox.status, ['queued', 'failed', 'blocked'])))
      .run().changes;
    // Hat der Sender die Sendung inzwischen aufgenommen, bleibt sie, wie sie ist.
    if (changed === 0) return dmsConflict('mailNotPending', { status: 'sending' });
  }
  insertMove(tx, deps, ctx, row.id, input.contactId, input.runRef);
  recordAudit(tx, deps, ctx, {
    action: 'dms.mail.toPost',
    entityType: 'document',
    entityId: row.id,
    ...(entry ? { before: { outboxId: entry.id, status: entry.status }, after: { outboxId: entry.id, status: 'withdrawn' } } : {}),
    params: { documentNumber: documentNumber(row) },
  });
  return ok(undefined);
}

/**
 * „Zurück zu E-Mail“ (Plan U4 Task 2): nur für einen Brief, der von Hand in die Post-Gruppe kam, und nur ohne
 * Versandvermerk. Das Paar steht danach wieder offen in der Mail-Gruppe; gesendet wird erst mit „… per E-Mail senden“.
 * In der Transaktion des Aufrufers, Protokoll `dms.mail.toEmail`.
 */
export function returnPairToEmailInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: PairMoveInput): Result<void> {
  const row = tx.select().from(documents).where(eq(documents.id, input.documentId)).get();
  if (!row) return notFound('document', input.documentId);
  const plan = planPair(tx, deps, row, input.contactId);
  if (plan.channel !== 'post' || plan.reason !== 'manual') return dmsConflict('mailNotMovedToPost');
  if (row.sentAt || input.dispatched) return dmsConflict('mailAlreadyDispatched');
  const now = isoNow(deps.clock);
  const move = latestMove(tx, row.id, input.contactId);
  if (move && !move.returnedAt) tx.update(dmsMailPostMoves).set({ returnedAt: now, returnedByUserId: ctx.userId }).where(eq(dmsMailPostMoves.id, move.id)).run();
  // Altbestand: eine zurückgezogene Sendung ohne Zeile des Verschiebens.
  else tx.insert(dmsMailPostMoves).values({ id: newId(), documentId: row.id, contactId: input.contactId, runRef: input.runRef, movedAt: now, movedByUserId: ctx.userId, returnedAt: now, returnedByUserId: ctx.userId }).run();
  recordAudit(tx, deps, ctx, { action: 'dms.mail.toEmail', entityType: 'document', entityId: row.id, params: { documentNumber: documentNumber(row) } });
  return ok(undefined);
}

/**
 * „Per Post schicken“: Eine wartende, gesperrte oder nicht zugestellte Sendung
 * wird zurückgezogen (`withdrawn`); das Paar gilt danach als Post. `dms.send`.
 */
export async function switchToPost(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ withdrawn: number }>> {
  const denied = requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const parsed = validate(deps, outboxIdsSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadEntries(deps, ctx, parsed.value.outboxIds);
  if (!loaded.ok) return loaded;
  const wrong = loaded.value.find((e) => e.status !== 'queued' && e.status !== 'failed' && e.status !== 'blocked');
  if (wrong) return dmsConflict('mailNotPending', { status: wrong.status });
  return deps.db.transaction((tx: DbOrTx) => {
    for (const entry of loaded.value) {
      // Bedingt: Hat der Sender die Sendung inzwischen aufgenommen, bleibt sie, wie sie ist.
      const changed = tx
        .update(dmsMailOutbox)
        .set({ status: 'withdrawn', nextAttemptAt: null })
        .where(and(eq(dmsMailOutbox.id, entry.id), inArray(dmsMailOutbox.status, ['queued', 'failed', 'blocked'])))
        .run().changes;
      if (changed === 0) continue;
      insertMove(tx, deps, ctx, entry.documentId, entry.contactId, entry.runRef);
      const row = tx.select({ number: documents.number }).from(documents).where(eq(documents.id, entry.documentId)).get();
      recordAudit(tx, deps, ctx, {
        action: 'dms.mail.toPost',
        entityType: 'document',
        entityId: entry.documentId,
        before: { outboxId: entry.id, status: entry.status },
        after: { outboxId: entry.id, status: 'withdrawn' },
        params: { documentNumber: row?.number ?? '' },
      });
    }
    return ok({ withdrawn: loaded.value.length });
  });
}

/** Absender der Mails: Adresse aus den Einstellungen, Name dort oder der Vereinsname. */
export function mailSender(deps: Deps): { from: { address: string; name: string }; replyTo?: string } | null {
  const address = readSetting<string | null>(deps, 'dms.mail.fromAddress');
  if (!address) return null;
  const name = readSetting<string | null>(deps, 'dms.mail.fromName') ?? readSetting<string>(deps, 'organization.name');
  const replyTo = readSetting<string | null>(deps, 'dms.mail.replyTo');
  return { from: { address, name }, ...(replyTo ? { replyTo } : {}) };
}

/**
 * Systemmail des Kerns (Haken `systemMail`, Spec Backup § Meldungen): direkt über den Transport wie die Testmail,
 * nicht über den Ausgangskorb, der an Dokumente gebunden ist. Kein Protokolleintrag — eine Systemmail ändert keinen
 * Datensatz. Verfügbar nur mit Absender und eingerichtetem Versand (`ready` oder Umleitung).
 */
export const dmsSystemMail: SystemMailHook = {
  available: (deps) => {
    const kind = deps.mail.state().kind;
    return mailSender(deps) !== null && (kind === 'ready' || kind === 'redirect');
  },
  send: async (deps, message) => {
    const sender = mailSender(deps);
    if (!sender) return { sent: false, reason: 'unavailable' };
    const result = await deps.mail.send({ to: message.to, ...sender, subject: message.subject, text: message.text });
    return result.ok ? { sent: true } : { sent: false, reason: 'sendFailed' };
  },
};

/**
 * „Testmail an mich senden“: an die Adresse des angemeldeten Nutzers, direkt
 * über den Transport, ohne Ausgangskorb. Das Protokoll nennt keine Adresse.
 * `dms.send`, nur ein Mensch.
 */
export async function sendTestMail(deps: Deps, ctx: CallContext): Promise<Result<{ address: string }>> {
  const denied = requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, DMS_HUMAN_ONLY_SETTING);
  if (human) return human;
  const user = ctx.userId ? deps.db.select({ email: coreSchema.users.email }).from(coreSchema.users).where(eq(coreSchema.users.id, ctx.userId)).get() : undefined;
  if (!user || !z.email().safeParse(user.email).success) return dmsConflict('noUserEmail');
  const notReady = mailNotReady(deps);
  if (notReady) return notReady;
  const sender = mailSender(deps)!;
  const locale = deps.locales()[0] ?? 'de';
  const texts = TEST_MAIL_TEXTS[locale] ?? TEST_MAIL_TEXTS.de!;
  const result = await deps.mail.send({
    to: user.email,
    ...sender,
    subject: texts.subject,
    text: fillMailPlaceholders(texts.body, { Verein: readSetting<string>(deps, 'organization.name') }),
  });
  if (!result.ok) return dmsConflict('mailTestFailed', { code: result.code });
  return deps.db.transaction((tx: DbOrTx) => {
    recordAudit(tx, deps, ctx, { action: 'dms.mail.test', entityType: 'module', entityId: 'dms', params: {} });
    return ok({ address: user.email });
  });
}

export interface OutboxListItem {
  id: string;
  documentId: string;
  documentNumber: string | null;
  documentSubject: string;
  contactId: string;
  /** Name über den Kontakt; ist er gelöscht, `null`. */
  contactName: string | null;
  /** Bis zur Entfernung nach 90 Tagen; danach `null`. */
  toAddress: string | null;
  status: MailOutboxStatus;
  attempts: number;
  lastErrorCode: string | null;
  lastErrorText: string | null;
  queuedAt: string;
  /** Wer die Sendung ausgelöst hat (nur die ID; den Namen löst die Anzeige auf). */
  queuedByUserId: string | null;
  sentAt: string | null;
  runRef: string | null;
}

/** Der Ausgang, neueste zuerst. `dms.view`; Sendungen geschützter Dokumente nur mit deren Bereichsrecht. */
export async function listOutbox(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: OutboxListItem[]; total: number }>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, outboxListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const conditions: SQL[] = [];
  if (q.status) conditions.push(eq(dmsMailOutbox.status, q.status));
  if (q.documentId) conditions.push(eq(dmsMailOutbox.documentId, q.documentId));
  if (q.runRef) conditions.push(eq(dmsMailOutbox.runRef, q.runRef));
  if (q.from) conditions.push(gte(dmsMailOutbox.queuedAt, q.from));
  if (q.days) conditions.push(gte(dmsMailOutbox.queuedAt, new Date(Date.parse(`${todayIn(deps)}T00:00:00.000Z`) - (q.days - 1) * 86_400_000).toISOString()));
  if (q.to) conditions.push(lte(dmsMailOutbox.queuedAt, `${q.to}T23:59:59.999Z`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = deps.db
    .select({ entry: dmsMailOutbox, doc: documents })
    .from(dmsMailOutbox)
    .innerJoin(documents, eq(documents.id, dmsMailOutbox.documentId))
    .where(where)
    .orderBy(desc(dmsMailOutbox.queuedAt), desc(dmsMailOutbox.id))
    .all()
    .filter(({ doc }) => !requireAreaAccess(deps, ctx, doc));
  const page = rows.slice(q.offset, q.offset + q.limit);
  const ids = [...new Set(page.map(({ entry }) => entry.contactId))];
  const people = ids.length > 0 ? deps.db.select().from(contacts).where(inArray(contacts.id, ids)).all() : [];
  const items = page.map(({ entry, doc }): OutboxListItem => {
    const person = people.find((p) => p.id === entry.contactId);
    return {
      id: entry.id,
      documentId: doc.id,
      documentNumber: doc.number,
      documentSubject: doc.subject,
      contactId: entry.contactId,
      contactName: person ? displayName(person) : null,
      toAddress: entry.addressPurgedAt || !entry.toAddress ? null : entry.toAddress,
      status: entry.status,
      attempts: entry.attempts,
      lastErrorCode: entry.lastErrorCode,
      lastErrorText: entry.lastErrorText,
      queuedAt: entry.queuedAt,
      queuedByUserId: entry.queuedByUserId,
      sentAt: entry.sentAt,
      runRef: entry.runRef,
    };
  });
  return ok({ items, total: rows.length });
}

export type MailDraftRecipient =
  | { contactId: string; name: string; channel: 'email'; address: string; via: 'self' | 'organization'; outboxStatus: MailOutboxStatus | null; /** Der Begleittext für diesen Empfänger, wie er hinausginge. */ body: string }
  | { contactId: string | null; name: string | null; channel: 'post'; reason: SendPlanReason };

export interface DocumentMailDraft {
  documentId: string;
  documentNumber: string | null;
  subject: string;
  fileName: string | null;
  fileBytes: number | null;
  /** Der Textbaustein des Begleittexts (`null`: der mitgelieferte Text) — für „Textbaustein ändern“. */
  bodySnippetId: string | null;
  /** Zustand des Versands und ob ein Absender eingetragen ist. */
  mail: { kind: MailState['kind']; redirectTo: string | null; sender: boolean };
  recipients: MailDraftRecipient[];
  /** Alle Sendungen dieses Dokuments, neueste oben (Handoff 2b E2). */
  sendings: OutboxListItem[];
}

/**
 * Alles, was „Per E-Mail senden“ am Dokument zeigt (Handoff 2b E2): je Empfänger
 * Weg und Grund, mit Adresse und Begleittext, Betreff, Anhang, Zustand des
 * Versands und die bisherigen Sendungen. Nur lesen. `dms.view`.
 */
export async function documentMailDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentMailDraft>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, documentIdSchema, input);
  if (!parsed.ok) return parsed;
  const { documentId } = parsed.value;
  const planned = planDocuments(deps, ctx, [documentId]);
  if (!planned.ok) return planned;
  const row = deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!;
  const ids = planned.value.flatMap((item) => (item.contactId ? [item.contactId] : []));
  const people = ids.length > 0 ? deps.db.select().from(contacts).where(inArray(contacts.id, ids)).all() : [];
  const nameOf = (id: string | null) => {
    const person = id ? people.find((p) => p.id === id) : undefined;
    return person ? displayName(person) : null;
  };
  const recipients = planned.value.map((item): MailDraftRecipient => {
    if (item.channel === 'post') return { contactId: item.contactId, name: nameOf(item.contactId), channel: 'post', reason: item.reason };
    const person = people.find((p) => p.id === item.contactId);
    const body = mailBodyFor(deps, { typeKey: row.typeKey, subject: row.subject, number: row.number ?? '', documentDate: row.documentDate }, { name: person ? displayName(person) : '', salutation: person?.salutation ?? null });
    return { contactId: item.contactId, name: nameOf(item.contactId) ?? '', channel: 'email', address: item.address, via: item.via, outboxStatus: item.outboxStatus ?? null, body };
  });
  const sendings = await listOutbox(deps, ctx, { documentId, limit: 200 });
  if (!sendings.ok) return sendings;
  const state = deps.mail.state();
  return ok({
    documentId,
    documentNumber: row.number,
    subject: row.subject,
    fileName: row.number ? `${row.number}.pdf` : null,
    fileBytes: row.fileBytes ?? null,
    bodySnippetId: mailBodySnippetFor(deps, row.typeKey).id,
    mail: { kind: state.kind, redirectTo: state.kind === 'redirect' ? state.to : null, sender: !!readSetting<string | null>(deps, 'dms.mail.fromAddress') },
    recipients,
    sendings: sendings.value.items,
  });
}

