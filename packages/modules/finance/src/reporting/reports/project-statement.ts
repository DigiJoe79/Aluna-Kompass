import { notFound, paperDate, type DbOrTx, type Failure } from '@kompass/core';
import { projects } from '@kompass/module-projects';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { undocumentedEntriesOf } from '../../ledger/period';
import { projectBalances, purposeBalancesAt } from '../../ledger/queries';
import { financeAllocationLines, financeCategories, financeEntries, financeEntryDocuments, financeProjectSettings, financePurposes } from '../../schema';
import type { ReportDefinition, ReportLinesFilter, ReportParams, ReportRenderContext } from '../types';
import { amountCell, checkYearOrDate, emptyCell, heading, paragraph, reportYearInternal, spanRow, strongAmountCell, strongCell, table, textCell, type ReportYear } from './common';

/**
 * Projektabrechnung (Finanz-Spec § 9.2, Rechenschaft B1 Task 3): je Projekt Ziel, Einnahmen und Ausgaben je
 * Kategorie, Ergebnis im Jahr und seit Beginn, die Zwecke des Projekts und die Belegliste. Ohne Personenbezug: die
 * Belegliste trägt weder Buchungstext noch Kontakt (Entscheidung 4 des Plans). Ohne `projectId` alle Projekte mit
 * festgeschriebenen Zeilen im Jahr, mit `projectId` nur dieses (auch leer).
 */

export interface ProjectStatementEntry {
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  categoryId: string;
  /** Vorzeichen wie gebucht. */
  amountCents: number;
  documentNumbers: string[];
  withoutVoucher: boolean;
}

export interface ProjectStatementProject {
  projectId: string;
  targetCents: number | null;
  income: { categoryId: string; sumCents: number }[];
  /** Ausgaben positiv. */
  expense: { categoryId: string; sumCents: number }[];
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
  /** Bis zum Ende des Jahres, ohne Anfang. */
  sinceStart: { incomeCents: number; expenseCents: number; resultCents: number };
  purposes: { purposeId: string; closingCents: number }[];
  entries: ProjectStatementEntry[];
}

export interface ProjectStatementReport {
  year: ReportYear;
  projectId: string | null;
  projects: ProjectStatementProject[];
}

const paramsSchema: z.ZodType<ReportParams> = z.object({ fiscalYearId: z.string().min(1), projectId: z.string().min(1).optional() });

function checkParams(db: DbOrTx, params: ReportParams): Failure | null {
  const missing = checkYearOrDate(db, params);
  if (missing) return missing;
  if (params.projectId !== undefined && !db.select({ id: projects.id }).from(projects).where(eq(projects.id, params.projectId)).get()) return notFound('project', params.projectId);
  return null;
}

type LineRow = { entryId: string; entryNumber: string | null; entryDate: string; categoryId: string; direction: string; amountCents: number };

/** Einnahme und Ausgabe nach der Richtung der Kategorie, Umbuchungen nach dem Vorzeichen — wie `projectBalances`. */
const isIncome = (l: LineRow) => (l.direction === 'income' ? true : l.direction === 'expense' ? false : l.amountCents > 0);

function sumByCategory(lines: LineRow[], income: boolean): { categoryId: string; sumCents: number }[] {
  const sums = new Map<string, number>();
  for (const l of lines.filter((x) => isIncome(x) === income)) sums.set(l.categoryId, (sums.get(l.categoryId) ?? 0) + (income ? l.amountCents : -l.amountCents));
  return [...sums].map(([categoryId, sumCents]) => ({ categoryId, sumCents })).sort((a, b) => b.sumCents - a.sumCents || a.categoryId.localeCompare(b.categoryId));
}

export function computeProjectStatementReport(db: DbOrTx, params: ReportParams): ProjectStatementReport {
  const year = reportYearInternal(db, params.fiscalYearId!);
  const inYear = projectBalances(db, { from: year.startsOn, to: year.endsOn });
  const sinceStart = new Map(projectBalances(db, { to: year.endsOn }).map((b) => [b.projectId, b]));
  const ids = params.projectId !== undefined ? [params.projectId] : inYear.map((b) => b.projectId).sort();
  if (ids.length === 0) return { year, projectId: params.projectId ?? null, projects: [] };

  const lines = db
    .select({ projectId: financeAllocationLines.projectId, entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate, categoryId: financeAllocationLines.categoryId, direction: financeCategories.direction, amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), inArray(financeAllocationLines.projectId, ids), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn)))
    .orderBy(asc(financeEntries.entryDate), asc(financeEntries.number), asc(financeAllocationLines.position))
    .all();
  const entryIds = [...new Set(lines.map((l) => l.entryId))];
  const documentsByEntry = new Map<string, string[]>();
  if (entryIds.length > 0) {
    const links = db
      .select({ entryId: financeEntryDocuments.entryId, number: financeEntryDocuments.documentNumber })
      .from(financeEntryDocuments)
      .where(and(inArray(financeEntryDocuments.entryId, entryIds), isNull(financeEntryDocuments.revokedAt)))
      .orderBy(asc(financeEntryDocuments.documentNumber))
      .all();
    for (const l of links) documentsByEntry.set(l.entryId, [...(documentsByEntry.get(l.entryId) ?? []), l.number]);
  }
  const undocumented = new Set(undocumentedEntriesOf(db, year.id).map((u) => u.entryId));
  const balances = new Map(purposeBalancesAt(db, year.endsOn).map((b) => [b.purposeId, b.balanceCents]));
  const purposes = db.select({ id: financePurposes.id, projectId: financePurposes.projectId }).from(financePurposes).where(and(isNotNull(financePurposes.projectId), inArray(financePurposes.projectId, ids))).orderBy(asc(financePurposes.createdAt), asc(financePurposes.id)).all();
  const targets = new Map(db.select().from(financeProjectSettings).where(inArray(financeProjectSettings.projectId, ids)).all().map((s) => [s.projectId, s.targetCents]));

  return {
    year,
    projectId: params.projectId ?? null,
    projects: ids.map((projectId): ProjectStatementProject => {
      const own = lines.filter((l) => l.projectId === projectId);
      const income = sumByCategory(own, true);
      const expense = sumByCategory(own, false);
      const incomeCents = income.reduce((s, c) => s + c.sumCents, 0);
      const expenseCents = expense.reduce((s, c) => s + c.sumCents, 0);
      const total = sinceStart.get(projectId);
      // Je Buchung und Kategorie eine Zeile (eine Buchung kann mehrere Zeilen dieses Projekts tragen).
      const entries = new Map<string, ProjectStatementEntry>();
      for (const l of own) {
        const key = `${l.entryId}|${l.categoryId}`;
        const row = entries.get(key);
        if (row) row.amountCents += l.amountCents;
        else entries.set(key, { entryId: l.entryId, entryNumber: l.entryNumber, entryDate: l.entryDate, categoryId: l.categoryId, amountCents: l.amountCents, documentNumbers: documentsByEntry.get(l.entryId) ?? [], withoutVoucher: undocumented.has(l.entryId) });
      }
      return {
        projectId,
        targetCents: targets.get(projectId) ?? null,
        income,
        expense,
        incomeCents,
        expenseCents,
        resultCents: incomeCents - expenseCents,
        sinceStart: { incomeCents: total?.incomeCents ?? 0, expenseCents: total?.expenseCents ?? 0, resultCents: total?.resultCents ?? 0 },
        purposes: purposes.filter((p) => p.projectId === projectId).map((p) => ({ purposeId: p.id, closingCents: balances.get(p.id) ?? 0 })),
        entries: [...entries.values()],
      };
    }),
  };
}

// ── Papier ─────────────────────────────────────────────────────────────────

function projectTypst(p: ProjectStatementProject, ctx: ReportRenderContext): string {
  const parts = [heading(2, ctx.labels[`project.${p.projectId}`] ?? p.projectId)];
  const head: string[][] = [];
  if (p.targetCents !== null) head.push([textCell('Ziel'), amountCell(p.targetCents)], [textCell('Stand seit Beginn'), amountCell(p.sinceStart.incomeCents)]);
  for (const purpose of p.purposes) head.push([textCell(`Zweckbestand ${ctx.labels[`purpose.${purpose.purposeId}`] ?? purpose.purposeId}`), amountCell(purpose.closingCents)]);
  if (head.length > 0) parts.push(table('(1fr, 32mm)', ['in €', 'Betrag'], head));

  const rows: string[][] = [[spanRow(3, 'Einnahmen')]];
  for (const c of p.income) rows.push([textCell(ctx.categoryNames[c.categoryId] ?? c.categoryId), amountCell(c.sumCents), emptyCell]);
  rows.push([strongCell('Summe Einnahmen'), strongAmountCell(p.incomeCents), strongAmountCell(p.sinceStart.incomeCents)]);
  rows.push([spanRow(3, 'Ausgaben')]);
  for (const c of p.expense) rows.push([textCell(ctx.categoryNames[c.categoryId] ?? c.categoryId), amountCell(c.sumCents), emptyCell]);
  rows.push([strongCell('Summe Ausgaben'), strongAmountCell(p.expenseCents), strongAmountCell(p.sinceStart.expenseCents)]);
  rows.push([strongCell('Ergebnis'), strongAmountCell(p.resultCents), strongAmountCell(p.sinceStart.resultCents)]);
  parts.push(table('(1fr, 32mm, 32mm)', ['in €', 'Jahr', 'Seit Beginn'], rows));

  if (p.entries.length > 0) {
    parts.push(heading(3, 'Belegliste'));
    parts.push(
      table(
        '(22mm, 26mm, 1fr, 26mm, 40mm)',
        ['Datum', 'Nr.', 'Kategorie', 'in €', 'Belege'],
        p.entries.map((e) => [textCell(paperDate(e.entryDate as never)), textCell(e.entryNumber ?? ''), textCell(ctx.categoryNames[e.categoryId] ?? e.categoryId), amountCell(e.amountCents), textCell(e.withoutVoucher ? 'ohne Beleg' : e.documentNumbers.join(', '))]),
      ),
    );
  }
  return parts.join('\n\n');
}

/** Ohne Projekt: der Satz des PDF, zugleich `empty` des Berichts (Designer Runde 7, 16a D). */
const PROJECTS_EMPTY = 'Im Geschäftsjahr gibt es keine festgeschriebenen Buchungen an Projekten.';

export function projectStatementTypst(data: ProjectStatementReport, ctx: ReportRenderContext): string {
  if (data.projects.length === 0) return paragraph(PROJECTS_EMPTY);
  return data.projects.map((p) => projectTypst(p, ctx)).join('\n\n');
}

/** Je Projekt Einnahmen und Ausgaben für `finance_lines_list`. */
function linesFilter(data: ProjectStatementReport): Record<string, ReportLinesFilter> {
  return Object.fromEntries(
    data.projects.flatMap((p) => (['income', 'expense'] as const).map((direction) => [`${p.projectId}.${direction}`, { fiscalYearId: data.year.id, projectId: p.projectId, direction }] as const)),
  );
}

export const projectStatementReport: ReportDefinition<ProjectStatementReport> = {
  key: 'projectStatement',
  group: 'work',
  // Eine Arbeitsliste wie Monatsübersicht und Übergabeliste: immer vorläufig, nur zum Herunterladen (Designer Runde 7,
  // 261 und Abweichung 12 — ändert die Entscheidung aus E4).
  finalizable: false,
  personal: false,
  available: true,
  orientation: 'portrait',
  paramsSchema,
  checkParams,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: computeProjectStatementReport,
  toTypst: projectStatementTypst,
  empty: (data) => (data.projects.length === 0 ? PROJECTS_EMPTY : null),
  titleKey: 'finance.reports.projectStatement.title',
  paperTitle: 'Projektabrechnung',
  linesFilter,
};
