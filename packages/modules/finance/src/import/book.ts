import { isoNow, notFound, ok, requireHumanChannel, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { entryLinesSchema, entryViewInternal, saveDraft, setReviewed, type EntryLinesInput, type EntryView } from '../ledger/entries';
import { bookEntry } from '../ledger/finalize';
import { financeAccounts, financeCategories, financeEntries, financeImportRuns, financeMoneyLines, financeRawTransactions, type FinanceRawTransactionRow } from '../schema';
import { learnContactIbanInternal } from './contact-ibans';

/**
 * Handeln aus der Arbeitsliste (F5, Spec 6.4): aus einem Kontoumsatz buchen
 * und einen Kontoumsatz an eine vorhandene Buchung hängen. Beides ruft die
 * Dienste von `ledger/` auf, statt sie nachzubauen — `saveDraft`,
 * `setReviewed`, `bookEntry` prüfen und protokollieren wie immer.
 */

type MoneyLineInput = EntryLinesInput['moneyLines'][number];

const settlementSchema = z.object({ openItemId: z.string().min(1), amountCents: z.number().int().positive() });

/** Die Zeilen wie bei `saveDraft` — dieselben Felder, damit ein Vorschlag (`SuggestionView.draft`) unverändert hineinpasst. */
const lineSchemas = entryLinesSchema.shape;

export const bookFromTransactionSchema = z.object({
  rawTransactionId: z.string().min(1),
  /** Vorgabe: das Buchungsdatum des Kontoumsatzes. */
  entryDate: z.string().date().optional(),
  text: z.string().trim().min(1).max(300),
  allocationLines: lineSchemas.allocationLines,
  /** Weitere Geldzeilen — bei einer Umbuchung der Gegen-Umsatz auf dem anderen Konto, gegen die Barkasse die Kassenzeile. */
  extraMoneyLines: lineSchemas.moneyLines.optional(),
  /** Die offenen Zahlungen, die die Geldzeile des Kontoumsatzes begleicht. */
  settlements: z.array(settlementSchema).optional(),
  reviewed: z.boolean(),
  /** Der Entwurf, den die Arbeitsliste an diesem Umsatz zeigte — er wird ersetzt, statt einen zweiten anzulegen. */
  expectedDraftId: z.string().min(1).optional(),
});

const linkSchema = z.object({ rawTransactionId: z.string().min(1), entryId: z.string().min(1) });

/** Die Buchung, die den Umsatz gerade bindet — auch ein Entwurf bindet (F4 Task 4). */
export function boundEntryIdInternal(db: DbOrTx, rawId: string): string | null {
  return db.select({ entryId: financeMoneyLines.entryId }).from(financeMoneyLines).where(and(eq(financeMoneyLines.rawTransactionId, rawId), isNull(financeMoneyLines.rawReleasedAt))).get()?.entryId ?? null;
}

/** Den Kontoumsatz laden: bekannt und aus einem nicht verworfenen Auszug. */
export function usableRawInternal(db: DbOrTx, rawId: string): Result<FinanceRawTransactionRow> {
  const raw = db.select().from(financeRawTransactions).where(eq(financeRawTransactions.id, rawId)).get();
  if (!raw) return notFound('financeRawTransaction', rawId);
  const run = db.select({ discardedAt: financeImportRuns.discardedAt }).from(financeImportRuns).where(eq(financeImportRuns.id, raw.runId)).get();
  if (run?.discardedAt) return financeConflict('rawTransactionDiscarded');
  return ok(raw);
}

/**
 * Eine stillgelegte Kategorie lehnt schon hier ab, nicht erst beim
 * Festschreiben — sonst entstünde ein Entwurf, der sich nie festschreiben
 * lässt (Review Focus 2). Die Abhilfe nennt die Einrichtung.
 */
function inactiveCategoryProblem(db: DbOrTx, allocationLines: readonly { categoryId: string }[]): Failure | null {
  const ids = [...new Set(allocationLines.map((l) => l.categoryId))];
  if (ids.length === 0) return null;
  const inactive = db.select({ name: financeCategories.name, isActive: financeCategories.isActive }).from(financeCategories).where(inArray(financeCategories.id, ids)).all().find((c) => !c.isActive);
  return inactive ? financeConflict('categoryInactive', { category: inactive.name }) : null;
}

function touchesCash(db: DbOrTx, moneyLines: readonly { accountId: string }[]): boolean {
  const ids = [...new Set(moneyLines.map((l) => l.accountId))];
  return db.select({ kind: financeAccounts.kind }).from(financeAccounts).where(inArray(financeAccounts.id, ids)).all().some((a) => a.kind === 'cash');
}

/**
 * `finance.entriesWrite`; mit `reviewed: true` **`humanOnly`** (Annahme 10):
 * „Übernehmen und geprüft“ mit einem Tastendruck. Baut die Geldzeile aus dem
 * Kontoumsatz (Konto, Betrag, Bindung) und ruft `saveDraft`, bei `reviewed`
 * danach `setReviewed`. Liegt eine Geldzeile auf einem Barkonto, lässt sich
 * nichts parken: mit `reviewed` schreibt `bookEntry` in einem Zug fest (braucht
 * `finance.entriesFinalize`), ohne wird `cashDraftNotAllowed` gemeldet.
 * Danach lernt Kompass je Zuordnung mit Kontakt die IBAN des Umsatzes
 * (`learnedFrom: 'booking'`, Annahme 2).
 */
export async function bookFromTransaction(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, bookFromTransactionSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.reviewed) {
    const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
    if (humanOnly) return humanOnly;
  }

  const loaded = usableRawInternal(deps.db, v.rawTransactionId);
  if (!loaded.ok) return loaded;
  const raw = loaded.value;

  // Was die Arbeitsliste zeigte, gilt nur, solange der Umsatz noch so gebunden ist.
  const boundTo = boundEntryIdInternal(deps.db, raw.id);
  if (v.expectedDraftId !== undefined) {
    if (boundTo !== v.expectedDraftId) return financeConflict('suggestionStale');
  } else if (boundTo !== null) {
    return financeConflict('transactionAlreadyBooked');
  }
  for (const line of v.extraMoneyLines ?? []) {
    if (!line.rawTransactionId) continue;
    const otherBound = boundEntryIdInternal(deps.db, line.rawTransactionId);
    if (otherBound !== null && otherBound !== v.expectedDraftId) return financeConflict('suggestionStale');
  }

  const inactive = inactiveCategoryProblem(deps.db, v.allocationLines);
  if (inactive) return inactive;

  const ownLine: MoneyLineInput = { accountId: raw.accountId, amountCents: raw.amountCents, rawTransactionId: raw.id, ...(v.settlements ? { settlements: v.settlements } : {}) };
  const moneyLines = [ownLine, ...(v.extraMoneyLines ?? [])];
  const lines = { entryDate: v.entryDate ?? raw.bookingDate, text: v.text, moneyLines, allocationLines: v.allocationLines };

  let result: Result<EntryView>;
  if (touchesCash(deps.db, moneyLines)) {
    if (!v.reviewed) return financeConflict('cashDraftNotAllowed');
    result = await bookEntry(deps, ctx, lines);
  } else {
    result = await saveDraft(deps, ctx, v.expectedDraftId ? { ...lines, id: v.expectedDraftId } : lines);
    if (result.ok && v.reviewed) result = await setReviewed(deps, ctx, { id: result.value.id, reviewed: true, expectedVersion: result.value.updatedAt });
  }
  if (!result.ok) return result;

  const contactIds = [...new Set(v.allocationLines.map((l) => l.contactId).filter((id): id is string => !!id))];
  if (raw.counterpartyIban && contactIds.length > 0) {
    deps.db.transaction((tx: DbOrTx) => {
      for (const contactId of contactIds) learnContactIbanInternal(tx, deps, ctx, { contactId, iban: raw.counterpartyIban!, learnedFrom: 'booking' });
    });
  }
  return result;
}

/**
 * `finance.entriesWrite`: „Dieser Umsatz passt zu Ihrer Buchung“ — setzt
 * `raw_transaction_id` einer Geldzeile von leer auf den Umsatz. Das geht auch
 * an einer festgeschriebenen Buchung (Spec 5.2; der Trigger
 * `finance_money_lines_final_raw_once` erlaubt genau diesen einen Schritt).
 * Gebunden wird genau eine Geldzeile auf dem Konto des Umsatzes mit
 * demselben Betrag und ohne Kontoumsatz, an einer Buchung, die weder
 * zurückgenommen noch selbst eine Rücknahme ist — sonst `entryLineNotBindable`.
 */
export async function linkTransactionToEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, linkSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const loaded = usableRawInternal(deps.db, v.rawTransactionId);
  if (!loaded.ok) return loaded;
  const raw = loaded.value;
  const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, v.entryId)).get();
  if (!entry) return notFound('financeEntry', v.entryId);
  if (boundEntryIdInternal(deps.db, raw.id) !== null) return financeConflict('transactionAlreadyBooked');

  const free = deps.db
    .select({ id: financeMoneyLines.id })
    .from(financeMoneyLines)
    .where(and(eq(financeMoneyLines.entryId, entry.id), eq(financeMoneyLines.accountId, raw.accountId), eq(financeMoneyLines.amountCents, raw.amountCents), isNull(financeMoneyLines.rawTransactionId)))
    .orderBy(asc(financeMoneyLines.position))
    .all();
  const reversedOrReversal = entry.reversedByEntryId !== null || entry.reversesEntryId !== null;
  if (free.length !== 1 || reversedOrReversal) return financeConflict('entryLineNotBindable');

  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeMoneyLines).set({ rawTransactionId: raw.id }).where(eq(financeMoneyLines.id, free[0]!.id)).run();
    // Ein Entwurf hat sich geändert — seine Version rückt vor; eine festgeschriebene Buchung bleibt, wie sie ist.
    if (entry.status === 'draft') tx.update(financeEntries).set({ updatedAt: isoNow(deps.clock) }).where(eq(financeEntries.id, entry.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.entry.rawLink', entity: 'financeEntry', id: entry.id, after: { entryId: entry.id, linkCount: 1 }, summary: `Kontoumsatz an Buchung ${entry.number ?? entry.id} verknüpft` });
    return ok(entryViewInternal(tx, entry.id)!);
  });
}
