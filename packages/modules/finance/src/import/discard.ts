import { isoNow, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { deleteDraftInternal, entryViewInternal } from '../ledger/entries';
import { financeEntries, financeEntryDocuments, financeImportCandidates, financeImportRuns, financeMoneyLines, financeRawTransactions } from '../schema';
import { importRunRowInternal, toRunView, type ImportRunView } from './runs';

/** Eine festgeschriebene, nicht zurückgenommene Buchung, die das Verwerfen sperrt (Spec 6.1). */
export interface DiscardBlockingEntry {
  entryId: string;
  number: string;
  entryDate: string;
  amountCents: number;
}

export interface DiscardPreview {
  rawTransactions: number;
  drafts: number;
  reviewedDrafts: number;
  vouchersKept: number;
  blocking: DiscardBlockingEntry[];
  canDiscard: boolean;
}

function rawIdsOfRun(db: DbOrTx, runId: string): string[] {
  return db.select({ id: financeRawTransactions.id }).from(financeRawTransactions).where(eq(financeRawTransactions.runId, runId)).all().map((r) => r.id);
}

/**
 * Nur nicht zurückgenommene festgeschriebene Buchungen sperren (Spec 6.1):
 * eine Geldzeile ohne `rawReleasedAt`, deren Buchung festgeschrieben und nicht
 * storniert (kein Fachbegriff, aber: nicht durch eine Gegenbuchung
 * zurückgenommen) ist.
 */
function blockingEntriesInternal(db: DbOrTx, rawIds: readonly string[]): DiscardBlockingEntry[] {
  if (rawIds.length === 0) return [];
  const rows = db
    .select({ entryId: financeEntries.id, number: financeEntries.number, entryDate: financeEntries.entryDate, amountCents: financeMoneyLines.amountCents })
    .from(financeMoneyLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .where(and(inArray(financeMoneyLines.rawTransactionId, [...rawIds]), isNull(financeMoneyLines.rawReleasedAt), eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId)))
    .all();
  return rows.map((r) => ({ entryId: r.entryId, number: r.number ?? r.entryId, entryDate: r.entryDate, amountCents: r.amountCents }));
}

/** Entwürfe (auch geprüfte), deren Geldzeile auf einen Rohumsatz dieses Laufs zeigt. */
function draftEntriesForRawInternal(db: DbOrTx, rawIds: readonly string[]): { entryId: string; reviewed: boolean }[] {
  if (rawIds.length === 0) return [];
  const rows = db
    .select({ entryId: financeEntries.id, reviewedAt: financeEntries.reviewedAt })
    .from(financeMoneyLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .where(and(inArray(financeMoneyLines.rawTransactionId, [...rawIds]), eq(financeEntries.status, 'draft')))
    .all();
  const byId = new Map<string, boolean>();
  for (const row of rows) byId.set(row.entryId, row.reviewedAt !== null);
  return [...byId.entries()].map(([entryId, reviewed]) => ({ entryId, reviewed }));
}

/** Nicht widerrufene Belege an den gegebenen Buchungen — was im Aktenmodul bleibt, wenn die Buchungen verschwinden. */
function voucherCountForEntries(db: DbOrTx, entryIds: readonly string[]): number {
  if (entryIds.length === 0) return 0;
  const where: SQL = and(inArray(financeEntryDocuments.entryId, [...entryIds]), isNull(financeEntryDocuments.revokedAt))!;
  return db.select({ id: financeEntryDocuments.id }).from(financeEntryDocuments).where(where).all().length;
}

const idSchema = z.object({ id: z.string().min(1) });

/**
 * Die Folgen eines Verwerfens in Zahlen (Spec 6.1, F4 Task 5) — `finance.read`.
 * Ein fehlgeschlagener oder bereits verworfener Lauf hat nichts (mehr) zu
 * verwerfen: die Vorschau zeigt Nullen und `canDiscard: false`, ohne Fehler.
 */
export async function previewDiscardRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DiscardPreview>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;

  const run = importRunRowInternal(deps.db, parsed.value.id);
  if (!run) return notFound('financeImportRun', parsed.value.id);

  if (run.failedAt !== null || run.discardedAt !== null) {
    return ok({ rawTransactions: 0, drafts: 0, reviewedDrafts: 0, vouchersKept: 0, blocking: [], canDiscard: false });
  }

  const rawIds = rawIdsOfRun(deps.db, run.id);
  const blocking = blockingEntriesInternal(deps.db, rawIds);
  const drafts = draftEntriesForRawInternal(deps.db, rawIds);
  const vouchersKept = voucherCountForEntries(deps.db, drafts.map((d) => d.entryId));

  return ok({
    rawTransactions: rawIds.length,
    drafts: drafts.length,
    reviewedDrafts: drafts.filter((d) => d.reviewed).length,
    vouchersKept,
    blocking,
    canDiscard: blocking.length === 0,
  });
}

const discardRunSchema = z.object({ id: z.string().min(1), note: z.string().trim().min(1).max(500) });

/**
 * Verwerfen (Spec 6.1, F4 Task 5): löscht die Rohumsätze des Laufs, die
 * Originaldatei — wenn kein anderer, nicht verworfener Lauf sie noch hält —,
 * offene Kandidaten und alle Entwürfe darauf (auch geprüfte); Belege an
 * diesen Entwürfen bleiben in der Akte, nur der Bezug wird gelöst. Der Lauf
 * selbst bleibt als Tatsache mit Prüfsumme und Zählern; Anschlussprüfung und
 * Dublettenschutz übergehen ihn ab jetzt.
 *
 * Kandidaten **dieses** Laufs werden ganz gelöscht (offen wie entschieden):
 * Eine „eigene Zahlung“-Entscheidung hat ihren neuen Rohumsatz stets in
 * diesem Lauf angelegt (`decideCandidate`) — der verschwindet gleich mit, und
 * der Fremdschlüssel des Kandidaten darauf verbietet ein Stehenlassen des
 * Kandidaten ohnehin (Trigger `finance_import_candidates_decide_once` sperrt
 * `raw_transaction_id` nach einer Entscheidung). Kandidaten **anderer**
 * Läufe, die einen Rohumsatz dieses Laufs als „bereits vorhanden“ zeigen,
 * verlieren nur diesen Bezug (`matches_raw_transaction_id` ist kein von
 * diesem Trigger geschütztes Feld) — ihre eigene Entscheidung bleibt stehen.
 *
 * `finance.entriesWrite`, **nicht** `humanOnly` (Spec 10.1: „Import, Lauf
 * verwerfen" steht unter `entriesWrite`).
 */
export async function discardRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ImportRunView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, discardRunSchema, input);
  if (!parsed.ok) return parsed;

  const before = importRunRowInternal(deps.db, parsed.value.id);
  if (!before) return notFound('financeImportRun', parsed.value.id);
  if (before.failedAt !== null || before.discardedAt !== null) return financeConflict('statementNotDiscardable');

  const rawIds = rawIdsOfRun(deps.db, before.id);
  const blocking = blockingEntriesInternal(deps.db, rawIds);
  if (blocking.length > 0) return financeConflict('statementDiscardBlocked');

  const oldFileKey = before.fileKey;
  let deleteFile = false;

  const result = deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);

    // 1. Entwürfe (auch geprüfte) samt Geldzeilen lösen — Belege bleiben in der Akte (Muster deleteDraft).
    for (const draft of draftEntriesForRawInternal(tx, rawIds)) {
      const view = entryViewInternal(tx, draft.entryId)!;
      deleteDraftInternal(tx, deps, ctx, view);
    }

    // 2. Kandidaten dieses Laufs vollständig löschen (offen und entschieden — siehe Doku oben).
    tx.delete(financeImportCandidates).where(eq(financeImportCandidates.runId, before.id)).run();

    // 3. Kandidaten anderer Läufe verlieren nur den Bezug auf einen Rohumsatz dieses Laufs.
    if (rawIds.length > 0) {
      tx.update(financeImportCandidates).set({ matchesRawTransactionId: null }).where(inArray(financeImportCandidates.matchesRawTransactionId, rawIds)).run();
    }

    // 4. Rohumsätze des Laufs.
    tx.delete(financeRawTransactions).where(eq(financeRawTransactions.runId, before.id)).run();

    // 5. Der Lauf bleibt als Tatsache — nur discarded_* und file_key -> NULL, je einmal (Trigger).
    tx.update(financeImportRuns).set({ discardedAt: now, discardedByUserId: ctx.userId, discardNote: parsed.value.note, fileKey: null }).where(eq(financeImportRuns.id, before.id)).run();

    // Mehrere Läufe teilen eine Datei (Mehrtages-Auszug) — die physische Datei geht erst,
    // wenn kein anderer, nicht verworfener Lauf denselben Schlüssel noch hält.
    const stillShared = oldFileKey !== null ? tx.select({ id: financeImportRuns.id }).from(financeImportRuns).where(and(eq(financeImportRuns.fileKey, oldFileKey), isNull(financeImportRuns.discardedAt))).limit(1).get() : undefined;
    deleteFile = oldFileKey !== null && !stillShared;

    // Nie die Notiz ins Protokoll (Spec 10.3) — nur, dass und wie.
    financeAudit(tx, deps, ctx, {
      action: 'finance.import.discard',
      entity: 'financeImportRun',
      id: before.id,
      after: { discarded: true, fileKeyCleared: true },
      summary: `Kontoauszug ${before.id} verworfen`,
    });

    return ok(toRunView(tx, importRunRowInternal(tx, before.id)!));
  });

  if (result.ok && deleteFile && oldFileKey !== null) await deps.files('finance').delete(oldFileKey);
  return result;
}
