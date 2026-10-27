import { invalid, type DbOrTx, type Failure } from '@kompass/core';
import { z } from 'zod';
import { valueAt } from '../../ledger/dated-values';
import { incomeStatement, type IncomeStatement, type Sphere } from '../../ledger/queries';
import type { ReportDefinition, ReportLinesFilter, ReportParams, ReportRenderContext } from '../types';
import { amountCell, checkYearOrDate, emptyCell, heading, paragraph, previousYearInternal, reportYearInternal, SPHERE_ORDER, SPHERE_TITLE, spanRow, strongAmountCell, strongCell, table, textCell, type ReportYear } from './common';

/**
 * Einnahmen-Überschuss-Rechnung nach Bereichen (Spec Rechenschaft 0.4.0 § Kernberichte, Finanz-Spec § 9.2): je
 * Bereich die Kategorien mit Summe und Vorjahr (fehlt das Vorjahr, entfällt die Spalte — nicht „0“), durchlaufende
 * Gelder getrennt. Darstellung „Zweckbetrieb und wGB zusammengefasst“ nur unter § 64 Abs. 3 S. 2 AO und erst ab 2026;
 * Warnungen bei Verlust im wGB oder in der Vermögensverwaltung, nie im Zweckbetrieb. Quer, Gruppe MV.
 */

export interface IncomeStatementReportCategory {
  categoryId: string;
  direction: 'income' | 'expense';
  /** Vorzeichen wie gebucht: Ausgaben negativ (wie `incomeStatement`). */
  sumCents: number;
  /** `null` ohne Vorjahr. */
  previousSumCents: number | null;
  lineCount: number;
}

export interface IncomeStatementReportSphere {
  sphere: Sphere;
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
  previousResultCents: number | null;
  categories: IncomeStatementReportCategory[];
}

export interface IncomeStatementReport {
  year: ReportYear;
  previous: { id: string; designation: string } | null;
  spheres: IncomeStatementReportSphere[];
  transit: { categoryId: string; sumCents: number }[];
  totalIncomeCents: number;
  totalExpenseCents: number;
  resultCents: number;
  /** Die Gesamtsummen des Vorjahres, `null` ohne Vorjahr (Spalte „Vorjahr“ auch in „Gesamt“, Designer Runde 7, 247). */
  previousTotals: { incomeCents: number; expenseCents: number; resultCents: number } | null;
  /** Darf „Zweckbetrieb und wGB zusammengefasst“ dargestellt werden (§ 64 Abs. 3 S. 2 AO, ab 2026)? */
  combineAllowed: boolean;
  combined: boolean;
  warnings: ('businessLoss' | 'assetManagementLoss')[];
}

const paramsSchema: z.ZodType<ReportParams> = z.object({ fiscalYearId: z.string().min(1), combineOperations: z.boolean().optional() });

/**
 * § 64 Abs. 3 S. 2 AO: Zweckbetrieb und wGB zusammen dürfen nur dargestellt werden, wenn die Reihe für den Stichtag
 * gilt (ab 2026), ihre Einnahmen brutto die Grenze nicht übersteigen und ihre Ergebnisse zusammen positiv sind.
 */
function combineAllowedOf(db: DbOrTx, statement: IncomeStatement, endsOn: string): boolean {
  const limit = valueAt(db, 'thresholdAllBusinessCombined', endsOn);
  if (limit === null) return false;
  const operations = statement.spheres.filter((s) => s.sphere === 'business' || s.sphere === 'purposeOperation');
  const income = operations.reduce((sum, s) => sum + s.incomeCents, 0);
  const result = operations.reduce((sum, s) => sum + s.resultCents, 0);
  return income <= Number(limit) && result > 0;
}

/** Rein: aus `incomeStatement` des Jahres und des Vorjahres. */
/** `until` (Rechenschaft C, Zwischenbericht): nur bis zu diesem Tag des Jahres, ohne Vorjahr — ein Teiljahr vergleicht sich nicht. */
export function computeIncomeStatementReport(db: DbOrTx, params: ReportParams, until?: string): IncomeStatementReport {
  const full = reportYearInternal(db, params.fiscalYearId!);
  const year = until ? { ...full, endsOn: until } : full;
  const previousYear = until ? null : previousYearInternal(db, year);
  const current = incomeStatement(db, { from: year.startsOn, to: year.endsOn });
  const prior = previousYear ? incomeStatement(db, { from: previousYear.startsOn, to: previousYear.endsOn }) : null;

  const spheres = SPHERE_ORDER.flatMap((sphere): IncomeStatementReportSphere[] => {
    const now = current.spheres.find((s) => s.sphere === sphere);
    const before = prior?.spheres.find((s) => s.sphere === sphere);
    if (!now && !before) return [];
    const ids = [...new Set([...(now?.categories ?? []), ...(before?.categories ?? [])].map((c) => c.categoryId))];
    const categories = ids
      .map((categoryId): IncomeStatementReportCategory => {
        const c = now?.categories.find((x) => x.categoryId === categoryId);
        const p = before?.categories.find((x) => x.categoryId === categoryId);
        return { categoryId, direction: (c ?? p)!.direction, sumCents: c?.sumCents ?? 0, previousSumCents: prior ? (p?.sumCents ?? 0) : null, lineCount: c?.lineCount ?? 0 };
      })
      .sort((a, b) => (a.direction === b.direction ? Math.abs(b.sumCents) - Math.abs(a.sumCents) || a.categoryId.localeCompare(b.categoryId) : a.direction === 'income' ? -1 : 1));
    return [{ sphere, incomeCents: now?.incomeCents ?? 0, expenseCents: now?.expenseCents ?? 0, resultCents: now?.resultCents ?? 0, previousResultCents: prior ? (before?.resultCents ?? 0) : null, categories }];
  });

  const resultOf = (sphere: Sphere) => spheres.find((s) => s.sphere === sphere)?.resultCents ?? 0;
  const warnings: IncomeStatementReport['warnings'] = [];
  if (resultOf('business') < 0) warnings.push('businessLoss');
  if (resultOf('assetManagement') < 0) warnings.push('assetManagementLoss');
  const combineAllowed = combineAllowedOf(db, current, year.endsOn);

  return {
    year,
    previous: previousYear ? { id: previousYear.id, designation: previousYear.designation } : null,
    spheres,
    transit: current.transit.map((t) => ({ categoryId: t.categoryId, sumCents: t.sumCents })),
    totalIncomeCents: current.totalIncomeCents,
    totalExpenseCents: current.totalExpenseCents,
    resultCents: current.resultCents,
    previousTotals: prior ? { incomeCents: prior.totalIncomeCents, expenseCents: prior.totalExpenseCents, resultCents: prior.resultCents } : null,
    combineAllowed,
    combined: combineAllowed && params.combineOperations === true,
    warnings,
  };
}

function checkParams(db: DbOrTx, params: ReportParams): Failure | null {
  const missing = checkYearOrDate(db, params);
  if (missing) return missing;
  if (params.combineOperations !== true) return null;
  return computeIncomeStatementReport(db, params).combineAllowed ? null : invalid([{ path: 'combineOperations', message: 'combineNotAllowed' }]);
}

// ── Papier ─────────────────────────────────────────────────────────────────

export const WARNING_TEXT: Record<IncomeStatementReport['warnings'][number], string> = {
  businessLoss:
    'Der wirtschaftliche Geschäftsbetrieb schließt mit einem Verlust. Gemeinnützige Mittel dürfen ihn nicht auf Dauer decken: Er ist binnen zwölf Monaten nach Ende des Geschäftsjahres auszugleichen, Anlaufverluste binnen drei Jahren (AEAO zu § 55 Nr. 4–8).',
  assetManagementLoss: 'Die Vermögensverwaltung schließt mit einem Verlust. Für ihn gilt dasselbe wie für einen Verlust im wirtschaftlichen Geschäftsbetrieb (AEAO zu § 55 Nr. 9).',
};

const COMBINED_TITLE = 'Zweckbetrieb und wirtschaftlicher Geschäftsbetrieb, zusammengefasst (§ 64 Abs. 3 S. 2 AO)';

/** Ausgaben stehen auf dem Papier positiv unter „Ausgaben“. */
const shown = (c: { direction: 'income' | 'expense' }, cents: number) => (c.direction === 'expense' ? -cents : cents);

/** Die Spaltenköpfe: das Jahr und das Vorjahr mit ihren Bezeichnungen (Designer Runde 7, 247). */
const yearHeads = (data: IncomeStatementReport): string[] => ['in €', data.year.designation, ...(data.previous ? [data.previous.designation] : [])];

/** Eine Summentabelle steht ganz auf einer Seite (Designer Runde 7, 247: „Gesamt“ brach nach „Einnahmen“ um). */
const unbroken = (body: string): string => `#block(breakable: false)[\n${body}\n]`;

function sphereTable(title: string, blocks: IncomeStatementReportSphere[], withPrevious: boolean, names: Record<string, string>, heads: string[]): string {
  const columns = withPrevious ? '(1fr, 32mm, 32mm)' : '(1fr, 32mm)';
  const width = withPrevious ? 3 : 2;
  const rows: string[][] = [];
  const sum = (pick: (s: IncomeStatementReportSphere) => number | null) => blocks.reduce<number | null>((acc, s) => (acc === null || pick(s) === null ? null : acc + pick(s)!), 0);
  for (const direction of ['income', 'expense'] as const) {
    const categories = blocks.flatMap((s) => s.categories).filter((c) => c.direction === direction);
    // Ohne Kategorie keine leere Zwischenzeile, nur die Summe (Designer Runde 7, 247 Zweckbetrieb).
    if (categories.length > 0) rows.push([spanRow(width, direction === 'income' ? 'Einnahmen' : 'Ausgaben')]);
    for (const c of categories) rows.push([textCell(names[c.categoryId] ?? c.categoryId), amountCell(shown(c, c.sumCents)), ...(withPrevious ? [c.previousSumCents === null ? emptyCell : amountCell(shown(c, c.previousSumCents))] : [])]);
    const total = direction === 'income' ? blocks.reduce((a, s) => a + s.incomeCents, 0) : blocks.reduce((a, s) => a + s.expenseCents, 0);
    const previousTotal = sum((s) => (s.previousResultCents === null ? null : s.categories.filter((c) => c.direction === direction).reduce((a, c) => a + shown(c, c.previousSumCents ?? 0), 0)));
    rows.push([strongCell(direction === 'income' ? 'Summe Einnahmen' : 'Summe Ausgaben'), strongAmountCell(total), ...(withPrevious ? [previousTotal === null ? emptyCell : strongAmountCell(previousTotal)] : [])]);
  }
  const previousResult = sum((s) => s.previousResultCents);
  rows.push([strongCell('Ergebnis'), strongAmountCell(blocks.reduce((a, s) => a + s.resultCents, 0)), ...(withPrevious ? [previousResult === null ? emptyCell : strongAmountCell(previousResult)] : [])]);
  return [heading(2, title), table(columns, heads, rows, { rightHeads: withPrevious ? [1, 2] : [1] })].join('\n\n');
}

export function incomeStatementTypst(data: IncomeStatementReport, ctx: ReportRenderContext): string {
  const withPrevious = data.previous !== null;
  const parts: string[] = [];
  const operations = data.spheres.filter((s) => s.sphere === 'purposeOperation' || s.sphere === 'business');
  for (const s of data.spheres) {
    if (data.combined && (s.sphere === 'purposeOperation' || s.sphere === 'business')) {
      if (s === operations[0]) parts.push(sphereTable(COMBINED_TITLE, operations, withPrevious, ctx.categoryNames, yearHeads(data)));
      continue;
    }
    parts.push(sphereTable(SPHERE_TITLE[s.sphere], [s], withPrevious, ctx.categoryNames, yearHeads(data)));
  }
  if (data.spheres.length === 0) parts.push(paragraph('Im Geschäftsjahr gibt es keine festgeschriebenen Einnahmen und Ausgaben.'));

  const prev = data.previousTotals;
  const prevCell = (pick: (t: NonNullable<typeof prev>) => number, strong = false) => (withPrevious ? [prev ? (strong ? strongAmountCell(pick(prev)) : amountCell(pick(prev))) : emptyCell] : []);
  parts.push(
    unbroken(
      [
        heading(2, 'Gesamt'),
        table(withPrevious ? '(1fr, 32mm, 32mm)' : '(1fr, 32mm)', yearHeads(data), [
          [textCell('Einnahmen'), amountCell(data.totalIncomeCents), ...prevCell((t) => t.incomeCents)],
          [textCell('Ausgaben'), amountCell(data.totalExpenseCents), ...prevCell((t) => t.expenseCents)],
          [strongCell('Ergebnis'), strongAmountCell(data.resultCents), ...prevCell((t) => t.resultCents, true)],
        ], { rightHeads: withPrevious ? [1, 2] : [1] }),
      ].join('\n\n'),
    ),
  );
  if (data.combined) parts.push(paragraph('Zusammengefasst nur in der Darstellung; Bereiche und Umsatzsteuer bleiben getrennt.'));
  if (data.transit.length > 0) {
    parts.push(heading(2, 'Durchlaufende Gelder (nicht im Ergebnis)'));
    parts.push(table('(1fr, 32mm)', ['in €', data.year.designation], data.transit.map((t) => [textCell(ctx.categoryNames[t.categoryId] ?? t.categoryId), amountCell(t.sumCents)])));
  }
  for (const w of data.warnings) parts.push(`#block(inset: (y: 4pt))[*Hinweis:* ${paragraph(WARNING_TEXT[w])}]`);
  return parts.join('\n\n');
}

/** Je Bereich und Richtung die Zeilen für `finance_lines_list`. */
function linesFilter(data: IncomeStatementReport): Record<string, ReportLinesFilter> {
  return Object.fromEntries(
    data.spheres.flatMap((s) => (['income', 'expense'] as const).map((direction) => [`${s.sphere}.${direction}`, { fiscalYearId: data.year.id, sphere: s.sphere, direction }] as const)),
  );
}

export const incomeStatementReport: ReportDefinition<IncomeStatementReport> = {
  key: 'incomeStatement',
  group: 'assembly',
  personal: false,
  available: true,
  orientation: 'landscape',
  paramsSchema,
  checkParams,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: (db, params) => computeIncomeStatementReport(db, params),
  toTypst: incomeStatementTypst,
  titleKey: 'finance.reports.incomeStatement.title',
  paperTitle: 'Einnahmen-Überschuss-Rechnung',
  linesFilter,
};
