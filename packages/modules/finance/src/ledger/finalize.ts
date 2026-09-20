import { isoNow, newId, notFound, ok, requireHumanChannel, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeAccounts, financeCategories, financeEntries, type FinanceAccountRow } from '../schema';
import { firstNegativeCashDay, formatEuro } from './cash-check';
import { valueAt } from './dated-values';
import { entryLinesSchema, entryViewInternal, resolveEntryLines, writeLinesInternal, type EntryView } from './entries';
import { allocateEntryNumber, ensureFiscalYearFor, fiscalYearStatusInternal } from './fiscal-years';
import type { TaxCode } from './tax';

const RATE_REQUIRING_CODES = new Set<TaxCode>(['reduced', 'standard', 'rc13b', 'icAcquisition']);

/** Ob für das Datum überhaupt gerechnet werden kann — Besteuerungsform und beide Sätze müssen hinterlegt sein. */
function hasTaxRate(db: DbOrTx, date: string): boolean {
  return valueAt(db, 'taxation', date) !== null && valueAt(db, 'vatStandard', date) !== null && valueAt(db, 'vatReduced', date) !== null;
}

/** Nur Nummern und Zähler — nie Text, nie Kontakt (Spec 10.3). */
function auditFields(view: EntryView, ctx: CallContext): Record<string, unknown> {
  const totalCents =
    view.moneyLines.length > 0
      ? view.moneyLines.reduce((s, l) => s + Math.abs(l.amountCents), 0)
      : view.allocationLines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
  return { status: view.status, number: view.number, entryDate: view.entryDate, fiscalYearId: view.fiscalYearId, moneyLineCount: view.moneyLines.length, allocationLineCount: view.allocationLines.length, totalCents, channel: ctx.channel };
}

/**
 * Ein `Result`-Fehler innerhalb einer Transaktion rollt sie nicht von selbst
 * zurück — nur ein Wurf tut das (Muster `abortIssue` der Akte). Gebraucht von
 * `bookEntry` (der neu angelegte Entwurf darf bei einem fehlgeschlagenen
 * Festschreiben nicht liegen bleiben) und `finalizeReviewed` (alle oder
 * keiner) sowie von `reverse.ts`.
 */
export class FinalizeAborted extends Error {
  constructor(readonly failure: Failure) {
    super('finalize aborted');
    this.name = 'FinalizeAborted';
  }
}
export function abortFinalize(failure: Failure): never {
  throw new FinalizeAborted(failure);
}

export interface FinalizeOptions {
  /**
   * `refuse` (Vorgabe): eine Kassenprüfung mit negativem Ergebnis lehnt ab
   * (`cashWouldGoNegative`). `reasonGiven`: `reverse.ts` hat die Prüfung
   * bereits selbst gemacht und eine Begründung eingeholt — hier wird nicht
   * erneut geprüft.
   */
  cashCheck?: 'refuse' | 'reasonGiven';
  /** Der Buchungstext, gebildet aus der erst hier vergebenen Nummer (Storno: `Storno ${number}`). */
  textFromNumber?: (number: string) => string;
}

/**
 * Die sieben Prüfungen des Festschreibens, in einer bereits offenen
 * Transaktion (Finanz-Spec 5.4). Für `finalizeEntry`, `finalizeReviewed`,
 * `bookEntry` und `reverse.ts`.
 */
export function finalizeInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, entryId: string, opts: FinalizeOptions = {}): Result<EntryView> {
  const entry = entryViewInternal(tx, entryId);
  if (!entry) return notFound('financeEntry', entryId);
  if (entry.status !== 'draft') return financeConflict('entryNotDraft', { number: entry.number ?? entry.id });
  if (entry.moneyLines.length === 0 && entry.allocationLines.length === 0) return financeConflict('entryEmpty');

  const moneySum = entry.moneyLines.reduce((s, l) => s + l.amountCents, 0);
  const allocationSum = entry.allocationLines.reduce((s, l) => s + l.amountCents, 0);
  if (moneySum !== allocationSum) {
    return financeConflict('entryUnbalanced', { rest: formatEuro(moneySum - allocationSum), money: formatEuro(moneySum), allocated: formatEuro(allocationSum) });
  }

  const accounts = new Map<string, FinanceAccountRow>();
  for (const line of entry.moneyLines) {
    if (!accounts.has(line.accountId)) accounts.set(line.accountId, tx.select().from(financeAccounts).where(eq(financeAccounts.id, line.accountId)).get()!);
  }
  for (const account of accounts.values()) {
    if (!account.isActive) return financeConflict('accountInactive', { account: account.name });
  }

  const categories = new Map<string, { name: string; isActive: boolean }>();
  for (const line of entry.allocationLines) {
    if (!categories.has(line.categoryId)) categories.set(line.categoryId, tx.select().from(financeCategories).where(eq(financeCategories.id, line.categoryId)).get()!);
  }
  for (const category of categories.values()) {
    if (!category.isActive) return financeConflict('categoryInactive', { category: category.name });
  }

  const yearResult = ensureFiscalYearFor(tx, deps, ctx, entry.entryDate);
  if (!yearResult.ok) return yearResult;
  const year = yearResult.value;
  if (fiscalYearStatusInternal(tx, year.id) === 'closed') return financeConflict('fiscalYearClosed', { year: year.designation });

  const needsRate = entry.allocationLines.some((l) => RATE_REQUIRING_CODES.has(l.taxCode as TaxCode));
  if (needsRate && !hasTaxRate(tx, entry.entryDate)) return financeConflict('noTaxRateForDate', { date: entry.entryDate });

  if ((opts.cashCheck ?? 'refuse') === 'refuse') {
    for (const [accountId, account] of accounts) {
      if (account.kind !== 'cash') continue;
      const extra = entry.moneyLines.filter((l) => l.accountId === accountId).map((l) => ({ date: entry.entryDate, amountCents: l.amountCents }));
      const negative = firstNegativeCashDay(tx, account, entry.entryDate, extra);
      if (negative) return financeConflict('cashWouldGoNegative', { account: account.name, date: negative.date, amount: formatEuro(negative.balanceCents) });
    }
  }

  const number = allocateEntryNumber(tx, year.id);
  const now = isoNow(deps.clock);
  tx.update(financeEntries)
    .set({ status: 'final', number, finalizedAt: now, finalizedByUserId: ctx.userId, finalizedChannel: ctx.channel, fiscalYearId: year.id, updatedAt: now, ...(opts.textFromNumber ? { text: opts.textFromNumber(number) } : {}) })
    .where(eq(financeEntries.id, entryId))
    .run();
  const after = entryViewInternal(tx, entryId)!;
  financeAudit(tx, deps, ctx, { action: 'finance.entry.finalize', entity: 'financeEntry', id: entryId, after: auditFields(after, ctx), summary: `Buchung ${number} festgeschrieben` });
  return ok(after);
}

const finalizeEntrySchema = z.object({ id: z.string().min(1), expectedVersion: z.string().min(1).optional() });

/** `finance.entriesFinalize`, **`humanOnly`**. */
export async function finalizeEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, finalizeEntrySchema, input);
  if (!parsed.ok) return parsed;
  const before = entryViewInternal(deps.db, parsed.value.id);
  if (!before) return notFound('financeEntry', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => finalizeInternal(tx, deps, ctx, parsed.value.id));
}

const finalizeReviewedSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

/** `finance.entriesFinalize`, **`humanOnly`**: Sammellauf, nur geprüfte Entwürfe, alle oder keiner. */
export async function finalizeReviewed(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ entries: EntryView[]; sumsByAccount: { accountId: string; sumCents: number }[] }>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, finalizeReviewedSchema, input);
  if (!parsed.ok) return parsed;

  const loaded: EntryView[] = [];
  for (const id of parsed.value.ids) {
    const view = entryViewInternal(deps.db, id);
    if (!view) return notFound('financeEntry', id);
    loaded.push(view);
  }
  const notDraft = loaded.find((v) => v.status !== 'draft');
  if (notDraft) return financeConflict('entryNotDraft', { number: notDraft.number ?? notDraft.id });
  const unreviewedCount = loaded.filter((v) => v.reviewedAt === null).length;
  if (unreviewedCount > 0) return financeConflict('notReviewed', { count: unreviewedCount });

  const sorted = [...loaded].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.createdAt.localeCompare(b.createdAt));

  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const finalized: EntryView[] = [];
      for (const entry of sorted) {
        const result = finalizeInternal(tx, deps, ctx, entry.id);
        if (!result.ok) abortFinalize(result);
        finalized.push(result.value);
      }
      const sums = new Map<string, number>();
      for (const entry of finalized) for (const line of entry.moneyLines) sums.set(line.accountId, (sums.get(line.accountId) ?? 0) + line.amountCents);
      return ok({ entries: finalized, sumsByAccount: [...sums.entries()].map(([accountId, sumCents]) => ({ accountId, sumCents })) });
    });
  } catch (error) {
    if (error instanceof FinalizeAborted) return error.failure;
    throw error;
  }
}

/** `finance.entriesWrite` und `finance.entriesFinalize`, **`humanOnly`**: Anlegen und Festschreiben in einer Transaktion — der einzige Weg für Bargeld. */
export async function bookEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const deniedWrite = requirePermission(ctx, 'finance.entriesWrite');
  if (deniedWrite) return deniedWrite;
  const deniedFinalize = requirePermission(ctx, 'finance.entriesFinalize');
  if (deniedFinalize) return deniedFinalize;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, entryLinesSchema, input);
  if (!parsed.ok) return parsed;
  const resolved = resolveEntryLines(deps, parsed.value);
  if (!resolved.ok) return resolved;

  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const now = isoNow(deps.clock);
      const id = newId();
      tx.insert(financeEntries)
        .values({ id, number: null, entryDate: parsed.value.entryDate, text: parsed.value.text, status: 'draft', createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel, createdAt: now, updatedAt: now })
        .run();
      writeLinesInternal(tx, id, resolved.value);
      const result = finalizeInternal(tx, deps, ctx, id);
      if (!result.ok) abortFinalize(result);
      return result;
    });
  } catch (error) {
    if (error instanceof FinalizeAborted) return error.failure;
    throw error;
  }
}
