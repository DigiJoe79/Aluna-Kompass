import { isoNow, newId, notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { eq, inArray } from 'drizzle-orm';
import { contacts, displayName } from '@kompass/module-contacts';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { financeAccounts, financeCategories, financeEntries, type FinanceAccountRow } from '../schema';
import { boardAllowanceProblemInternal } from './board';
import { purposeGoingNegative, purposeNegativeProblemInternal } from './purpose-negative';
import { firstNegativeCashDay } from './cash-check';
import { valueAt } from './dated-values';
import { entryLinesSchema, entryViewInternal, resolveEntryLines, writeLinesInternal, type AllowanceExceededNotice, type EntryNotice, type EntryView } from './entries';
import { allowanceCapCents, allowanceTotalCents, overCapCents } from './allowances';
import { attachSettledItemDocumentsInternal } from './vouchers';
import { certifiableOutflowInternal } from './not-return';
import { foreignMoneyOverpaidInternal } from './foreign-money';
import { allocateEntryNumber, ensureFiscalYearFor, fiscalYearForInternal, fiscalYearStatusInternal } from './fiscal-years';
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
  /**
   * Ersetzt den Buchungstext, sobald diese Buchung selbst ihre Nummer erhält
   * (Storno: `Storno ${original.number}` — die Nummer der stornierten
   * Buchung, aus `reverse.ts` schon im Aufschluss gebunden, nicht die eigene,
   * hier erst vergebene Nummer).
   */
  textFromNumber?: (number: string) => string;
}

/**
 * Die Prüfungen des Festschreibens, die nichts schreiben (Finanz-Spec 5.4):
 * Entwurf, nicht leer, ausgeglichen, Konten und Kategorien aktiv, das
 * Geschäftsjahr — soweit es schon existiert — nicht abgeschlossen, ein
 * Steuersatz für den Tag. `finalizeInternal` ruft sie zuerst; die Vorschau
 * des Sammel-Festschreibens (`import/batch.ts`, F5) ruft sie allein. Was nur
 * mit Schreiben geht — das Geschäftsjahr anlegen — und die Kassenprüfung, die
 * vom Aufrufer abhängt, bleiben in `finalizeInternal`.
 */
export function checkFinalizableInternal(tx: DbOrTx, entryId: string, today?: string): Failure | null {
  const entry = entryViewInternal(tx, entryId);
  if (!entry) return notFound('financeEntry', entryId);
  if (entry.status !== 'draft') return financeConflict('entryNotDraft', { number: entry.number ?? entry.id });
  if (entry.moneyLines.length === 0 && entry.allocationLines.length === 0) return financeConflict('entryEmpty');
  // Befund 20: heute selbst ist erlaubt, danach nicht — der Entwurf durfte mit einer Warnung entstehen (`saveDraft`).
  if (today !== undefined && entry.entryDate > today) return financeConflict('entryDateInFuture', { date: entry.entryDate, today });

  const moneySum = entry.moneyLines.reduce((s, l) => s + l.amountCents, 0);
  const allocationSum = entry.allocationLines.reduce((s, l) => s + l.amountCents, 0);
  if (moneySum !== allocationSum) {
    return financeConflict('entryUnbalanced', { rest: moneySum - allocationSum, money: moneySum, allocated: allocationSum });
  }

  for (const account of accountsOf(tx, entry).values()) {
    if (!account.isActive) return financeConflict('accountInactive', { account: account.name });
  }

  const categories = new Map<string, { name: string; isActive: boolean }>();
  for (const line of entry.allocationLines) {
    if (!categories.has(line.categoryId)) categories.set(line.categoryId, tx.select().from(financeCategories).where(eq(financeCategories.id, line.categoryId)).get()!);
  }
  for (const category of categories.values()) {
    if (!category.isActive) return financeConflict('categoryInactive', { category: category.name });
  }

  const overpaid = foreignMoneyOverpaidInternal(tx, entryId, entry.allocationLines);
  if (overpaid) return overpaid;

  const year = fiscalYearForInternal(tx, entry.entryDate);
  if (year && fiscalYearStatusInternal(tx, year.id) === 'closed') return financeConflict('fiscalYearClosed', { year: year.designation });

  const needsRate = entry.allocationLines.some((l) => RATE_REQUIRING_CODES.has(l.taxCode as TaxCode));
  if (needsRate && !hasTaxRate(tx, entry.entryDate)) return financeConflict('noTaxRateForDate', { date: entry.entryDate });
  return null;
}

function accountsOf(tx: DbOrTx, entry: EntryView): Map<string, FinanceAccountRow> {
  const accounts = new Map<string, FinanceAccountRow>();
  for (const line of entry.moneyLines) {
    if (!accounts.has(line.accountId)) accounts.set(line.accountId, tx.select().from(financeAccounts).where(eq(financeAccounts.id, line.accountId)).get()!);
  }
  return accounts;
}

/**
 * Befund 25: eine Barspende ab `finance.cashDonationAlertCents` — nur ein
 * Hinweis für die Kassenprüfung, keine Sperre; die Schwelle speist sonst nur
 * die Prüfpaket-Liste (§ 9.4 F10b). `0` oder keine Einstellung schaltet ihn ab.
 */
function cashDonationAboveAlertInternal(tx: DbOrTx, deps: Deps, entry: EntryView): boolean {
  const thresholdCents = readSetting<number>(deps, 'finance.cashDonationAlertCents');
  if (!thresholdCents || thresholdCents <= 0) return false;
  const cashAccountIds = new Set([...accountsOf(tx, entry).values()].filter((a) => a.kind === 'cash').map((a) => a.id));
  if (cashAccountIds.size === 0 || !entry.moneyLines.some((l) => cashAccountIds.has(l.accountId))) return false;
  const categoryIds = [...new Set(entry.allocationLines.map((l) => l.categoryId))];
  if (categoryIds.length === 0) return false;
  const incomeKindByCategory = new Map(tx.select({ id: financeCategories.id, incomeKind: financeCategories.incomeKind }).from(financeCategories).where(inArray(financeCategories.id, categoryIds)).all().map((c) => [c.id, c.incomeKind] as const));
  return entry.allocationLines.some((l) => incomeKindByCategory.get(l.categoryId) === 'donation' && l.amountCents >= thresholdCents);
}

/**
 * Befund AI: Nach dem Festschreiben — liegt eine Person, an die diese Buchung
 * eine Pauschale zahlt, im Kalenderjahr der Zahlung über der Grenze? Eine
 * Warnung ohne Pflichtbegründung; der übersteigende Betrag ist nicht
 * steuerfrei. Gezählt wie die Personenübersicht.
 */
function allowanceExceededInternal(tx: DbOrTx, entry: EntryView): AllowanceExceededNotice[] {
  const paid = entry.allocationLines.filter((l) => l.contactId && l.amountCents < 0);
  if (paid.length === 0) return [];
  const kinds = new Map(tx.select({ id: financeCategories.id, allowanceKind: financeCategories.allowanceKind }).from(financeCategories).where(inArray(financeCategories.id, [...new Set(paid.map((l) => l.categoryId))])).all().map((c) => [c.id, c.allowanceKind] as const));
  const year = Number(entry.entryDate.slice(0, 4));
  const seen = new Set<string>();
  const out: AllowanceExceededNotice[] = [];
  for (const line of paid) {
    const kind = kinds.get(line.categoryId);
    if (kind !== 'volunteer' && kind !== 'trainer') continue;
    const key = `${line.contactId}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const overCents = overCapCents(allowanceTotalCents(tx, line.contactId!, kind, year), allowanceCapCents(tx, kind, year));
    if (overCents === 0) continue;
    const contact = tx.select().from(contacts).where(eq(contacts.id, line.contactId!)).get();
    out.push({ contactId: line.contactId!, contactName: contact ? displayName(contact) : '', kind, year, overCents });
  }
  return out;
}

/**
 * Die Prüfungen des Festschreibens, in einer bereits offenen Transaktion
 * (Finanz-Spec 5.4): erst `checkFinalizableInternal`, dann das Geschäftsjahr
 * (legt den Nachfolger bei Bedarf an) und die Kassenprüfung. Für
 * `finalizeEntry`, `finalizeReviewed`, `bookEntry` und `reverse.ts`.
 */
export function finalizeInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, entryId: string, opts: FinalizeOptions = {}): Result<EntryView> {
  const problem = checkFinalizableInternal(tx, entryId, todayIn(deps));
  if (problem) return problem;
  const entry = entryViewInternal(tx, entryId)!;

  const yearResult = ensureFiscalYearFor(tx, deps, ctx, entry.entryDate);
  if (!yearResult.ok) return yearResult;
  const year = yearResult.value;

  if ((opts.cashCheck ?? 'refuse') === 'refuse') {
    for (const [accountId, account] of accountsOf(tx, entry)) {
      if (account.kind !== 'cash') continue;
      const extra = entry.moneyLines.filter((l) => l.accountId === accountId).map((l) => ({ date: entry.entryDate, amountCents: l.amountCents }));
      const negative = firstNegativeCashDay(tx, account, entry.entryDate, extra);
      if (negative) return financeConflict('cashWouldGoNegative', { account: account.name, date: negative.date, amount: negative.balanceCents });
    }
  }

  if (!entry.reversesEntryId) attachSettledItemDocumentsInternal(tx, deps, ctx, entryId);
  const number = allocateEntryNumber(tx, year.id);
  const now = isoNow(deps.clock);
  tx.update(financeEntries)
    .set({ status: 'final', number, finalizedAt: now, finalizedByUserId: ctx.userId, finalizedChannel: ctx.channel, fiscalYearId: year.id, updatedAt: now, ...(opts.textFromNumber ? { text: opts.textFromNumber(number) } : {}) })
    .where(eq(financeEntries.id, entryId))
    .run();
  const after = entryViewInternal(tx, entryId)!;
  const notices: EntryNotice[] = cashDonationAboveAlertInternal(tx, deps, after) ? ['cashDonationAboveAlert'] : [];
  const exceeded = after.reversesEntryId ? [] : allowanceExceededInternal(tx, after);
  if (exceeded.length > 0) notices.push('allowanceExceeded');
  // N2: eine Rückgabe auf einer Spenden-Kategorie ohne Bezug — Hinweis, keine Sperre.
  if (!after.reversesEntryId && certifiableOutflowInternal(tx, entryId, { withoutOrigin: true })) notices.push('returnWithoutOrigin');
  financeAudit(tx, deps, ctx, { action: 'finance.entry.finalize', entity: 'financeEntry', id: entryId, after: auditFields(after, ctx), summary: `Buchung ${number} festgeschrieben` });
  return ok(notices.length > 0 ? { ...after, notices, ...(exceeded.length > 0 ? { allowanceExceeded: exceeded } : {}) } : after);
}

/** Befund AH für einen gespeicherten Entwurf: die Lage am Buchungstag, mit der am Entwurf gespeicherten Begründung. Nie für eine Rücknahme. */
function boardAllowanceProblemOf(deps: Deps, entry: EntryView): Failure | null {
  if (entry.reversesEntryId) return null;
  return boardAllowanceProblemInternal(deps.db, deps, { entryDate: entry.entryDate, reason: entry.boardAllowanceReason, lines: entry.allocationLines })
    ?? purposeNegativeProblemInternal(deps.db, { reason: entry.purposeNegativeReason, lines: entry.allocationLines });
}

const finalizeEntrySchema = z.object({ id: z.string().min(1), expectedVersion: z.string().min(1).optional() });

/** `finance.entriesFinalize`, **`humanOnly`**. */
export async function finalizeEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, finalizeEntrySchema, input);
  if (!parsed.ok) return parsed;
  const before = entryViewInternal(deps.db, parsed.value.id);
  if (!before) return notFound('financeEntry', parsed.value.id);
  if (before.status === 'draft') {
    const boardProblem = boardAllowanceProblemOf(deps, before);
    if (boardProblem) return boardProblem;
  }
  return deps.db.transaction((tx: DbOrTx) => finalizeInternal(tx, deps, ctx, parsed.value.id));
}

const finalizeReviewedSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

/** `finance.entriesFinalize`, **`humanOnly`**: Sammellauf, nur geprüfte Entwürfe, alle oder keiner. */
export async function finalizeReviewed(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ entries: EntryView[]; sumsByAccount: { accountId: string; sumCents: number }[] }>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
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
  for (const view of loaded) {
    const boardProblem = boardAllowanceProblemOf(deps, view);
    if (boardProblem) return boardProblem;
  }

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
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, entryLinesSchema, input);
  if (!parsed.ok) return parsed;
  const resolved = resolveEntryLines(deps, parsed.value);
  if (!resolved.ok) return resolved;
  const v = parsed.value;
  const boardProblem = boardAllowanceProblemInternal(deps.db, deps, { entryDate: v.entryDate, reason: v.reason, lines: v.allocationLines });
  if (boardProblem) return boardProblem;
  const boardAllowanceReason = boardAllowanceProblemInternal(deps.db, deps, { entryDate: v.entryDate, reason: null, lines: v.allocationLines }) ? v.reason!.trim() : null;
  const purposeProblem = purposeNegativeProblemInternal(deps.db, { reason: v.reason, lines: v.allocationLines });
  if (purposeProblem) return purposeProblem;
  const purposeNegativeReason = purposeGoingNegative(deps.db, v.allocationLines) ? v.reason!.trim() : null;

  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const result = bookEntryInternal(tx, deps, ctx, { entryDate: v.entryDate, text: v.text, lines: resolved.value, boardAllowanceReason, purposeNegativeReason });
      if (!result.ok) abortFinalize(result);
      return result;
    });
  } catch (error) {
    if (error instanceof FinalizeAborted) return error.failure;
    throw error;
  }
}

/**
 * Anlegen und Festschreiben in einer bereits offenen Transaktion, ohne
 * Rechteprüfung — für `bookEntry` und Vorgänge, die im eigenen Namen buchen
 * (F8a: die Aufwandsspende aus der Freigabe unter `finance.approve`).
 * `beforeFinalize` hängt Belege an den Entwurf, bevor er festgeschrieben wird.
 * Ein Fehler rollt nicht von selbst zurück: Der Aufrufer wirft
 * (`abortFinalize` oder ein eigenes Muster).
 */
export function bookEntryInternal(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  input: { entryDate: string; text: string; lines: ReturnType<typeof resolveEntryLines> extends Result<infer L> ? L : never; beforeFinalize?: (entryId: string) => void; boardAllowanceReason?: string | null; purposeNegativeReason?: string | null },
): Result<EntryView> {
  const now = isoNow(deps.clock);
  const id = newId();
  tx.insert(financeEntries)
    .values({ id, number: null, entryDate: input.entryDate, text: input.text, boardAllowanceReason: input.boardAllowanceReason ?? null, purposeNegativeReason: input.purposeNegativeReason ?? null, status: 'draft', createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel, createdAt: now, updatedAt: now })
    .run();
  writeLinesInternal(tx, id, input.lines);
  input.beforeFinalize?.(id);
  return finalizeInternal(tx, deps, ctx, id);
}
