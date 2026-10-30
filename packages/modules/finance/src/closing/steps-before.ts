import { timeZoneOf, type Deps } from '@kompass/core';
import { zonedDayOf } from '../zoned-days';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { toCorrectConfirmationsOfYearInternal } from '../donations/to-correct';
import { uncertifiedDonationsInternal } from '../donations/confirmations';
import { foreignMoneyOpenAtInternal } from '../import/transit';
import { openItemsAtInternal } from '../ledger/open-items';
import { closePreviewInternal } from '../ledger/period';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { purposeBalancesAt } from '../ledger/queries';
import { reserveBalancesAt } from '../ledger/reserve-balances';
import { cashAtYearEndInternal } from '../ledger/cash-year-end';
import { accountStatementsForYearInternal, cashRecomputedConfirmationInternal } from '../ledger/statement-documents';
import { vouchersWithoutEntryCountInternal } from '../ledger/vouchers';
import { financePeriodEvents, financePurposes, financeReserveMovements, financeReserves, type FinanceFiscalYearRow } from '../schema';
import type { ClosingConfirmation, ClosingStepFacts, ClosingStepKey } from './types';
import { addDaysInternal } from '../allocation/partner-proof';

/**
 * Rechenschaft C, Schritte 1–8 (Spec § C, Finanz-Spec § 9.6, Plan C1 Task 3): je Schritt aus den vorhandenen
 * Bausteinen gerechnet, jeweils die interne Funktion, nie der Dienst. Was keine Grundlage hat (keine Kasse, keine
 * offenen Zahlungen, keine Zwecke mit Bestand, keine Rücklagen, keine Zuwendungen ohne Bestätigung), ist ohne
 * Bestätigung erledigt.
 */

export interface StepResult {
  done: boolean;
  confirmable: boolean;
  facts: ClosingStepFacts;
}

export interface StepContext {
  deps: Deps;
  year: FinanceFiscalYearRow;
  today: string;
  confirmation: (step: ClosingStepKey) => ClosingConfirmation | null;
}



function statementsStep(c: StepContext): StepResult {
  const preview = closePreviewInternal(c.deps.db, c.year, c.today);
  const accounts = accountStatementsForYearInternal(c.deps.db, c.year.id);
  const facts = { key: 'statements' as const, accounts, accountsWithoutImport: preview.accountsWithoutStatement.length, openTransactions: preview.openTransactionsInPeriod.length };
  // Zahlungsdienste: der Saldo aus dem Import oder eine Bestätigung (Spec § C, Schlussdurchsicht M1).
  const servicesOpen = accounts.some((a) => a.kind === 'paymentService' && !a.importedBalance && !a.confirmation);
  return { done: facts.accountsWithoutImport === 0 && facts.openTransactions === 0 && !servicesOpen && c.confirmation('statements') !== null, confirmable: true, facts };
}

/**
 * Je Kasse die Zählung am Stichtag oder die rückrechenbare spätere (`cashAtYearEndInternal`), dazu die Bestätigung
 * „rückgerechnet“ je Kasse (`cashRecomputed`, Board 14a). Erledigt, sobald jede Kasse gezählt oder bestätigt ist; der
 * Schritt selbst ist nicht bestätigbar.
 */
function cashStep(c: StepContext): StepResult {
  const accounts = cashAtYearEndInternal(c.deps.db, c.year).map((a) => ({ ...a, confirmation: a.count ? null : cashRecomputedConfirmationInternal(c.deps.db, c.year.id, a.accountId) }));
  return { done: accounts.every((a) => a.count !== null || a.confirmation !== null), confirmable: false, facts: { key: 'cash', accounts } };
}

/** Schritt 3: Entwürfe und unbegründete Buchungen ohne Beleg nie; Belege ohne Buchung und fremdes Geld leer oder bestätigt (Claude). */
function listsStep(c: StepContext): StepResult {
  const preview = closePreviewInternal(c.deps.db, c.year, c.today);
  const facts = {
    key: 'lists' as const,
    undocumentedUnjustified: preview.undocumented.filter((u) => !u.justified).length,
    undocumentedJustified: preview.undocumented.filter((u) => u.justified).length,
    drafts: preview.draftsInPeriod.length,
    vouchersWithoutEntry: vouchersWithoutEntryCountInternal(c.deps, { from: c.year.startsOn, to: c.year.endsOn }),
    foreignMoneyOpen: foreignMoneyOpenAtInternal(c.deps.db, c.year.endsOn).length,
  };
  const hard = facts.undocumentedUnjustified === 0 && facts.drafts === 0;
  const soft = facts.vouchersWithoutEntry > 0 || facts.foreignMoneyOpen > 0;
  const confirmable = hard && soft;
  return { done: hard && (!soft || c.confirmation('lists') !== null), confirmable, facts };
}

function openItemsStep(c: StepContext): StepResult {
  const open = openItemsAtInternal(c.deps.db, c.year.endsOn);
  const sum = (kind: 'receivable' | 'payable') => {
    const rows = open.filter((o) => o.kind === kind);
    return { count: rows.length, cents: rows.reduce((s, o) => s + o.openCents, 0) };
  };
  const facts = { key: 'openItems' as const, receivables: sum('receivable'), payables: sum('payable') };
  return { done: open.length === 0 || c.confirmation('openItems') !== null, confirmable: true, facts };
}

function purposesStep(c: StepContext): StepResult {
  const db = c.deps.db;
  const balances = purposeBalancesAt(db, c.year.endsOn);
  const open = balances.filter((b) => b.state === 'open' && b.balanceCents > 0);
  // F-B3 (0.4.5): der Tag in der Zone des Vereins, nicht der UTC-Tag.
  const timeZone = timeZoneOf(c.deps);
  const inYear = (at: string | null) => at !== null && zonedDayOf(at, timeZone) >= c.year.startsOn && zonedDayOf(at, timeZone) <= c.year.endsOn;
  const closedInYear = db
    .select({ fulfilledAt: financePurposes.fulfilledAt, dissolvedAt: financePurposes.dissolvedAt })
    .from(financePurposes)
    .all()
    .filter((p) => inYear(p.fulfilledAt) || inYear(p.dissolvedAt)).length;
  const facts = { key: 'purposes' as const, closedInYear, openWithBalance: open.length, restCents: open.reduce((s, b) => s + b.balanceCents, 0), negative: balances.filter((b) => b.balanceCents < 0).length };
  return { done: facts.negative === 0 && (facts.openWithBalance === 0 || c.confirmation('purposes') !== null), confirmable: true, facts };
}

/** Rücklagen, die im Jahr einen Bestand oder einen Vorgang hatten. */
function reservesStep(c: StepContext): StepResult {
  const db = c.deps.db;
  const opening = new Map(reserveBalancesAt(db, addDaysInternal(c.year.startsOn, -1)).map((b) => [b.reserveId, b.balanceCents]));
  const closing = new Map(reserveBalancesAt(db, c.year.endsOn).map((b) => [b.reserveId, b.balanceCents]));
  const moved = new Set(db.select({ reserveId: financeReserveMovements.reserveId }).from(financeReserveMovements).where(and(gte(financeReserveMovements.movementDate, c.year.startsOn), lte(financeReserveMovements.movementDate, c.year.endsOn))).all().map((m) => m.reserveId));
  const reserves = db
    .select()
    .from(financeReserves)
    .all()
    .map((r) => ({ reserveId: r.id, name: r.name, openingCents: opening.get(r.id) ?? 0, closingCents: closing.get(r.id) ?? 0, hasResolution: r.resolutionDocumentId !== null }))
    .filter((r) => r.openingCents !== 0 || r.closingCents !== 0 || moved.has(r.reserveId))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { done: reserves.length === 0 || c.confirmation('reserves') !== null, confirmable: true, facts: { key: 'reserves', reserves } };
}

/** Schritt 7 sperrt nichts (Joe 2026-10-24): Zahl, „zu korrigieren“ und die Bestätigung mit Begründung. */
function confirmationsStep(c: StepContext): StepResult {
  const uncertified = uncertifiedDonationsInternal(c.deps, { range: { from: c.year.startsOn, to: c.year.endsOn } }).reduce((s, g) => s + g.lines.length, 0);
  const toCorrect = toCorrectConfirmationsOfYearInternal(c.deps.db, c.year.id);
  const facts = { key: 'confirmations' as const, uncertified, toCorrect: toCorrect.length, toCorrectNumbers: toCorrect.slice(0, 3).map((t) => t.confirmation.documentNumber ?? '') };
  return { done: (uncertified === 0 && toCorrect.length === 0) || c.confirmation('confirmations') !== null, confirmable: true, facts };
}

function closeStep(c: StepContext): StepResult {
  const db = c.deps.db;
  const closed = fiscalYearStatusInternal(db, c.year.id) === 'closed';
  const closedAt = closed ? (db.select({ at: financePeriodEvents.at }).from(financePeriodEvents).where(and(eq(financePeriodEvents.fiscalYearId, c.year.id), eq(financePeriodEvents.kind, 'closed'))).orderBy(desc(financePeriodEvents.at)).get()?.at ?? null) : null;
  return { done: closed, confirmable: false, facts: { key: 'close', closedAt, preview: closed ? null : closePreviewInternal(db, c.year, c.today) } };
}

export const STEPS_BEFORE: Record<'statements' | 'cash' | 'lists' | 'openItems' | 'purposes' | 'reserves' | 'confirmations' | 'close', (c: StepContext) => StepResult> = {
  statements: statementsStep,
  cash: cashStep,
  lists: listsStep,
  openItems: openItemsStep,
  purposes: purposesStep,
  reserves: reservesStep,
  confirmations: confirmationsStep,
  close: closeStep,
};
