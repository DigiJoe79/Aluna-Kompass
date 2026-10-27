import { type DbOrTx } from '@kompass/core';
import { and, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { financeAllocationLines, financeCategories, financeEntries } from '../../schema';
import type { ReportDefinition, ReportLinesFilter, ReportParams, ReportRenderContext } from '../types';
import { amountCell, checkYearOrDate, emptyCell, paragraph, reportYearInternal, spanRow, strongAmountCell, strongCell, table, textCell, yearParamsSchema, type ReportYear } from './common';

/**
 * Monatsübersicht (Board Rechenschaft 2a, Gruppe Arbeit; Antwort Joe 2026-10-24): Einnahmen und Ausgaben je Kategorie
 * und Monat des Geschäftsjahres aus festgeschriebenen Zeilen, mit Summenzeile und -spalte. Ein Rumpfjahr zeigt nur
 * seine Monate. Wie die EÜR: nach der Richtung der Kategorie, Ausgaben positiv, Umbuchungen nicht im Ergebnis — in der
 * Summe gleich der Einnahmen-Überschuss-Rechnung des Jahres. Querformat.
 */

export interface MonthlyOverviewMonth {
  /** `JJJJ-MM`. */
  month: string;
  from: string;
  to: string;
}

export interface MonthlyOverviewCategory {
  categoryId: string;
  direction: 'income' | 'expense';
  /** Je Monat (Reihenfolge wie `months`): Einnahmen wie gebucht, Ausgaben positiv. */
  perMonth: number[];
  totalCents: number;
}

export interface MonthlyOverviewReport {
  year: ReportYear;
  months: MonthlyOverviewMonth[];
  categories: MonthlyOverviewCategory[];
  incomePerMonth: number[];
  expensePerMonth: number[];
  resultPerMonth: number[];
  totals: { incomeCents: number; expenseCents: number; resultCents: number };
}

const lastDayOf = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Die Monate des Jahres, am Rand auf Beginn und Ende des Jahres beschnitten. */
function monthsOf(year: ReportYear): MonthlyOverviewMonth[] {
  const months: MonthlyOverviewMonth[] = [];
  let [y, m] = year.startsOn.split('-').map(Number) as [number, number];
  for (;;) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (`${month}-01` > year.endsOn) break;
    const from = `${month}-01` < year.startsOn ? year.startsOn : `${month}-01`;
    const to = lastDayOf(month) > year.endsOn ? year.endsOn : lastDayOf(month);
    months.push({ month, from, to });
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return months;
}

export function computeMonthlyOverviewReport(db: DbOrTx, params: ReportParams): MonthlyOverviewReport {
  const year = reportYearInternal(db, params.fiscalYearId!);
  const months = monthsOf(year);
  const index = new Map(months.map((m, i) => [m.month, i]));
  const rows = db
    .select({ categoryId: financeAllocationLines.categoryId, direction: financeCategories.direction, month: sql<string>`substr(${financeEntries.entryDate}, 1, 7)`, sumCents: sql<number>`coalesce(sum(${financeAllocationLines.amountCents}), 0)` })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn), ne(financeCategories.direction, 'transit'), isNotNull(financeCategories.sphere)))
    .groupBy(financeAllocationLines.categoryId, sql`substr(${financeEntries.entryDate}, 1, 7)`)
    .all();

  const byCategory = new Map<string, MonthlyOverviewCategory>();
  for (const r of rows) {
    const direction = r.direction as 'income' | 'expense';
    const c = byCategory.get(r.categoryId) ?? { categoryId: r.categoryId, direction, perMonth: months.map(() => 0), totalCents: 0 };
    const value = direction === 'income' ? r.sumCents : -r.sumCents;
    c.perMonth[index.get(r.month)!] = (c.perMonth[index.get(r.month)!] ?? 0) + value;
    c.totalCents += value;
    byCategory.set(r.categoryId, c);
  }
  const categories = [...byCategory.values()].sort((a, b) => (a.direction === b.direction ? b.totalCents - a.totalCents || a.categoryId.localeCompare(b.categoryId) : a.direction === 'income' ? -1 : 1));
  const perMonth = (direction: 'income' | 'expense') => months.map((_m, i) => categories.filter((c) => c.direction === direction).reduce((s, c) => s + c.perMonth[i]!, 0));
  const incomePerMonth = perMonth('income');
  const expensePerMonth = perMonth('expense');
  const incomeCents = incomePerMonth.reduce((s, v) => s + v, 0);
  const expenseCents = expensePerMonth.reduce((s, v) => s + v, 0);
  return {
    year,
    months,
    categories,
    incomePerMonth,
    expensePerMonth,
    resultPerMonth: months.map((_m, i) => incomePerMonth[i]! - expensePerMonth[i]!),
    totals: { incomeCents, expenseCents, resultCents: incomeCents - expenseCents },
  };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const MONTH_TEXT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function monthlyOverviewTypst(data: MonthlyOverviewReport, ctx: ReportRenderContext): string {
  if (data.categories.length === 0) return paragraph('Im Geschäftsjahr gibt es keine festgeschriebenen Einnahmen und Ausgaben.');
  const width = data.months.length + 2;
  const columns = `(1fr, ${data.months.map(() => '15mm').join(', ')}, 19mm)`;
  const header = ['in €', ...data.months.map((m) => MONTH_TEXT[Number(m.month.slice(5, 7)) - 1]!), 'Summe'];
  const cell = (cents: number) => (cents === 0 ? emptyCell : amountCell(cents));
  const rows: string[][] = [];
  for (const direction of ['income', 'expense'] as const) {
    rows.push([spanRow(width, direction === 'income' ? 'Einnahmen' : 'Ausgaben')]);
    for (const c of data.categories.filter((x) => x.direction === direction)) rows.push([textCell(ctx.categoryNames[c.categoryId] ?? c.categoryId), ...c.perMonth.map(cell), amountCell(c.totalCents)]);
    const sums = direction === 'income' ? data.incomePerMonth : data.expensePerMonth;
    rows.push([strongCell(direction === 'income' ? 'Summe Einnahmen' : 'Summe Ausgaben'), ...sums.map(strongAmountCell), strongAmountCell(direction === 'income' ? data.totals.incomeCents : data.totals.expenseCents)]);
  }
  rows.push([strongCell('Ergebnis'), ...data.resultPerMonth.map(strongAmountCell), strongAmountCell(data.totals.resultCents)]);
  return `#set text(size: 7.5pt)\n\n${table(columns, header, rows)}`;
}

/** Je Kategorie und Monat die Zeilen für `finance_lines_list`. */
function linesFilter(data: MonthlyOverviewReport): Record<string, ReportLinesFilter> {
  return Object.fromEntries(
    data.categories.flatMap((c) => data.months.filter((_m, i) => c.perMonth[i] !== 0).map((m) => [`${c.categoryId}.${m.month}`, { fiscalYearId: data.year.id, categoryId: c.categoryId, from: m.from, to: m.to }] as const)),
  );
}

export const monthlyOverviewReport: ReportDefinition<MonthlyOverviewReport> = {
  key: 'monthlyOverview',
  group: 'work',
  personal: false,
  // Arbeitsbericht: nur herunterladen, nie festschreiben (Joe 2026-10-25).
  finalizable: false,
  available: true,
  orientation: 'landscape',
  paramsSchema: yearParamsSchema,
  checkParams: checkYearOrDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: computeMonthlyOverviewReport,
  toTypst: monthlyOverviewTypst,
  titleKey: 'finance.reports.monthlyOverview.title',
  paperTitle: 'Monatsübersicht',
  linesFilter,
};
