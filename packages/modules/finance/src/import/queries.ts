import { ok, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, desc, eq, gte, isNotNull, isNull, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { accountBalancesAt } from '../ledger/queries';
import { financeEntries, financeImportRuns, financeMoneyLines, financeRawTransactions, type FinanceRawTransactionRow } from '../schema';

/**
 * Ein Kontoumsatz, wie ihn beide Seiten sehen: die Liste „Hochgeladene
 * Auszüge“ (Task 7, F4) und die Kandidaten-Entscheidung (Task 4). Gegenpartei,
 * IBAN und Zweck sind personenbezogen — nur unter `finance.read` ausgeliefert
 * (Spec 10.1, 10.2); die Dienste hier verlangen es deshalb durchgängig.
 */
export interface RawTransactionView {
  id: string;
  runId: string;
  accountId: string;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  purpose: string;
  bankReference: string | null;
  endToEndId: string | null;
  returnCode: string | null;
  /** 'vorgeschlagen' kommt mit F5 (Anzeige) — für die Sperre zählt ein Entwurf schon als `booked` (Spec 5.2, F4 Task 4). */
  state: 'open' | 'booked';
  entryId: string | null;
  entryNumber: string | null;
  entryStatus: 'draft' | 'final' | null;
}

/**
 * Eine Geldzeile ohne `rawReleasedAt` bindet den Umsatz — ob ihre Buchung ein
 * Entwurf oder festgeschrieben ist, spielt für die Sperre keine Rolle (ein
 * Entwurf verhindert genauso eine zweite Buchung auf denselben Umsatz); die
 * Unterscheidung „vorgeschlagen“ vs. „gebucht“ zeigt erst F5. Ein Storno setzt
 * `rawReleasedAt` an der Original-Geldzeile (`reverseInternal`), macht den
 * Umsatz also wieder frei.
 */
function bookedEntryFor(db: DbOrTx, rawId: string): { entryId: string; entryNumber: string | null; entryStatus: 'draft' | 'final' } | null {
  const line = db.select({ entryId: financeMoneyLines.entryId }).from(financeMoneyLines).where(and(eq(financeMoneyLines.rawTransactionId, rawId), isNull(financeMoneyLines.rawReleasedAt))).get();
  if (!line) return null;
  const entry = db.select({ number: financeEntries.number, status: financeEntries.status }).from(financeEntries).where(eq(financeEntries.id, line.entryId)).get();
  if (!entry) return null;
  return { entryId: line.entryId, entryNumber: entry.number, entryStatus: entry.status as 'draft' | 'final' };
}

export function rawStateInternal(db: DbOrTx, rawId: string): 'open' | 'booked' {
  return bookedEntryFor(db, rawId) ? 'booked' : 'open';
}

export function rawTransactionViewInternal(db: DbOrTx, row: FinanceRawTransactionRow): RawTransactionView {
  const booked = bookedEntryFor(db, row.id);
  return {
    id: row.id,
    runId: row.runId,
    accountId: row.accountId,
    bookingDate: row.bookingDate,
    valueDate: row.valueDate,
    amountCents: row.amountCents,
    counterpartyName: row.counterpartyName,
    counterpartyIban: row.counterpartyIban,
    purpose: row.purpose,
    bankReference: row.bankReference,
    endToEndId: row.endToEndId,
    returnCode: row.returnCode,
    state: booked ? 'booked' : 'open',
    entryId: booked?.entryId ?? null,
    entryNumber: booked?.entryNumber ?? null,
    entryStatus: booked?.entryStatus ?? null,
  };
}

/** Für `getImportRun` (Task 3): alle Kontoumsätze eines Laufs, in der Reihenfolge der Datei. */
export function rawTransactionsForRunInternal(db: DbOrTx, runId: string): RawTransactionView[] {
  const rows = db.select().from(financeRawTransactions).where(eq(financeRawTransactions.runId, runId)).all();
  return rows.map((r) => rawTransactionViewInternal(db, r)).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
}

const listRawTransactionsSchema = z.object({
  accountId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  state: z.enum(['open', 'booked']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** `finance.read`: Gegenpartei, IBAN und Zweck sind personenbezogen (Spec 10.1). */
export async function listRawTransactions(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: RawTransactionView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listRawTransactionsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const conditions: SQL[] = [];
  if (v.accountId) conditions.push(eq(financeRawTransactions.accountId, v.accountId));
  if (v.runId) conditions.push(eq(financeRawTransactions.runId, v.runId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = deps.db.select().from(financeRawTransactions).where(where).orderBy(desc(financeRawTransactions.bookingDate), desc(financeRawTransactions.createdAt)).all();
  let views = rows.map((r) => rawTransactionViewInternal(deps.db, r));
  if (v.state) views = views.filter((view) => view.state === v.state);

  const total = views.length;
  const items = views.slice(v.offset, v.offset + v.limit);
  return ok({ items, total });
}

/**
 * Anzahl der offenen Kontoumsätze — für die Kacheln (Task 6, Spec 9.7):
 * „Umsätze ohne Zuordnung“. Klein genug, um im Speicher zu prüfen (Vereinsbuchhaltung).
 */
export function countOpenRawTransactionsInternal(db: DbOrTx, accountId?: string): number {
  const where = accountId ? eq(financeRawTransactions.accountId, accountId) : undefined;
  const rows = db.select({ id: financeRawTransactions.id }).from(financeRawTransactions).where(where).all();
  return rows.filter((r) => rawStateInternal(db, r.id) === 'open').length;
}

/**
 * „Importiert bis“ (Task 6, Spec 6.1, 9.7): das Ende des jüngsten fertigen,
 * nicht verworfenen Laufs eines Kontos — `null`, solange nie importiert wurde.
 */
export function importedThroughInternal(db: DbOrTx, accountId: string): string | null {
  const row = db
    .select({ periodTo: financeImportRuns.periodTo })
    .from(financeImportRuns)
    .where(and(eq(financeImportRuns.accountId, accountId), isNotNull(financeImportRuns.finishedAt), isNull(financeImportRuns.discardedAt)))
    .orderBy(desc(financeImportRuns.periodTo))
    .limit(1)
    .get();
  return row?.periodTo ?? null;
}

export interface BankReconciliation {
  state: 'matches' | 'differs' | 'noStatement';
  statementDate: string | null;
  bookCents: number;
  statementCents: number | null;
  differenceCents: number | null;
  /** Rechnet immer mit dem festgeschriebenen Buchbestand — nie mit geprüften Entwürfen (Spec 9.3). */
  basis: 'finalized';
}

/**
 * Kontenabstimmung `bank`/`paymentService` (Task 6, Spec 9.3): der
 * festgeschriebene Buchbestand zum Stichtag gegen den Endsaldo des Laufs,
 * dessen Zeitraum den Stichtag deckt — `noStatement`, wenn keiner ihn deckt.
 */
export function reconcileBankInternal(db: DbOrTx, accountId: string, date: string): BankReconciliation {
  const bookCents = accountBalancesAt(db, date).find((a) => a.accountId === accountId)?.balanceCents ?? 0;

  const covering = db
    .select({ periodTo: financeImportRuns.periodTo, closingCents: financeImportRuns.closingCents })
    .from(financeImportRuns)
    .where(
      and(
        eq(financeImportRuns.accountId, accountId),
        isNotNull(financeImportRuns.finishedAt),
        isNull(financeImportRuns.discardedAt),
        lte(financeImportRuns.periodFrom, date),
        gte(financeImportRuns.periodTo, date),
      ),
    )
    .orderBy(desc(financeImportRuns.startedAt))
    .limit(1)
    .get();

  if (!covering || covering.closingCents === null) return { state: 'noStatement', statementDate: null, bookCents, statementCents: null, differenceCents: null, basis: 'finalized' };

  const statementCents = covering.closingCents;
  const differenceCents = bookCents - statementCents;
  return { state: differenceCents === 0 ? 'matches' : 'differs', statementDate: covering.periodTo, bookCents, statementCents, differenceCents, basis: 'finalized' };
}
