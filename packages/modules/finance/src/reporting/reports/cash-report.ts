import { invalid, type DbOrTx, type Failure } from '@kompass/core';
import { z } from 'zod';
import { and, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { relatedPartyPaymentsInternal } from '../../allocation/people';
import { valueAt } from '../../ledger/dated-values';
import { accountBalancesAt, assetOverviewAt, purposeBalancesAt, type AccountKind } from '../../ledger/queries';
import { reserveBalanceAt } from '../../ledger/reserve-balances';
import { financeAccounts, financeAllocationCorrections, financeAuditCarryOverEntries, financeAuditCarryOvers, financeAllocationLines, financeCategories, financeEntries, financeFiscalYears, financeReserveMovements, financeReserves } from '../../schema';
import { dayBefore } from '../other-assets';
import type { ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { otherAssetsBlockInternal, type OtherAssetsBlock } from './asset-overview';
import { checkYearOrDate, reportAccountIdsInternal, reportYearInternal, type ReportYear } from './common';
import { computeIncomeStatementReport, type IncomeStatementReport } from './income-statement';
import { cashReportTypst } from './cash-report-typst';

/**
 * Kassenbericht — der Kassenteil des Jahresberichts (Spec Rechenschaft 0.4.0 § Kernberichte, §§ 259, 260 BGB; Board
 * 8a/8b): 1 Bestände am Anfang je Konto · 2 Einnahmen und Ausgaben je Kategorie nach Bereich · 3 Ergebnis · 4
 * durchlaufende Gelder · 5 Bestände am Ende · 6 Probe · 7 Zweckbindungen und Rücklagen · 8 offene Zahlungen · 9
 * sonstiges Vermögen (nachrichtlich) · 10 Zahlungen an Organmitglieder ohne Namen · 11 Korrekturen an Vorjahren.
 * Die Probe rechnet nur über Geld: Anfang + Eröffnungsbestände im Jahr + Ergebnis + Veränderung durchlaufend = Ende.
 * Geht sie nicht auf, zeigt der Bericht die Abweichung, und Festschreiben ist gesperrt. Quer, Gruppe MV.
 */

export interface CashReport {
  year: ReportYear;
  income: IncomeStatementReport;
  accounts: { accountId: string; kind: AccountKind; openingCents: number; openedInYearCents: number; closingCents: number }[];
  transit: { openingCents: number; inflowCents: number; outflowCents: number; closingCents: number };
  probe: { openingCents: number; openedInYearCents: number; resultCents: number; transitChangeCents: number; closingCents: number; differenceCents: number };
  bindings: {
    purposes: { purposeId: string; carryForwardCents: number; inflowCents: number; usedCents: number; closingCents: number }[];
    reserves: { reserveId: string; openingCents: number; addedCents: number; releasedCents: number; closingCents: number }[];
  };
  openItems: { receivablesCents: number; payablesCents: number };
  /** Bezeichnung und Grundlage über `ReportRenderContext.labels` (`otherAsset.<id>`), Designer 11h. */
  otherAssets: OtherAssetsBlock;
  organPayments: { role: 'board-member' | 'related-party'; kind: 'remuneration' | 'reimbursement' | 'other'; amountCents: number; personCount: number }[];
  /** Vorstandsmitglieder, deren Vergütung im Jahr die Grenze des § 31a BGB übersteigt. */
  organPersonsOverLiabilityLimit: number;
  /** Die Grenze des § 31a BGB am Jahresende (datiert), `null` ohne Reihe. */
  organLiabilityLimitCents: number | null;
  priorYearCorrections: { entryId: string; entryNumber: string; fiscalYearDesignation: string; appliedOn: string }[];
  /**
   * Rechenschaft C: Buchungen früherer Jahre, deren Änderung nach der MV in dieses Jahr übernommen wurde. Nur mit
   * Wert (Schlüssel fehlt sonst), damit der Hash eines Jahres ohne Übernahme bleibt.
   */
  /** Rechenschaft C: Zwischenbericht bis zu diesem Tag (Amtsübergabe); fehlt beim Ganzjahresbericht. */
  interimUntil?: string;
  priorYearCarryOvers?: { entryNumber: string; fiscalYearDesignation: string; change: 'new' | 'reversed' | 'changed' }[];
}

/** Aus den Tabellen der Übernahme (`auditing/carry-over.ts` schreibt sie) — `reporting/` liest `auditing/` nicht. */
function priorYearCarryOversOf(db: DbOrTx, year: ReportYear): NonNullable<CashReport['priorYearCarryOvers']> {
  return db
    .select({ entryNumber: financeAuditCarryOverEntries.entryNumber, fiscalYearDesignation: financeFiscalYears.designation, change: financeAuditCarryOverEntries.change })
    .from(financeAuditCarryOverEntries)
    .innerJoin(financeAuditCarryOvers, eq(financeAuditCarryOvers.id, financeAuditCarryOverEntries.carryOverId))
    .innerJoin(financeFiscalYears, eq(financeFiscalYears.id, financeAuditCarryOvers.fiscalYearId))
    .where(eq(financeAuditCarryOvers.targetFiscalYearId, year.id))
    .orderBy(financeFiscalYears.endsOn, financeAuditCarryOverEntries.entryNumber)
    .all();
}

/** Σ der Zeilen auf Durchlauf-Kategorien festgeschriebener Buchungen, getrennt nach Vorzeichen. */
function transitSums(db: DbOrTx, where: ReturnType<typeof and>) {
  const row = db
    .select({
      inflow: sql<number>`coalesce(sum(case when ${financeAllocationLines.amountCents} > 0 then ${financeAllocationLines.amountCents} else 0 end), 0)`,
      outflow: sql<number>`coalesce(sum(case when ${financeAllocationLines.amountCents} < 0 then -${financeAllocationLines.amountCents} else 0 end), 0)`,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), eq(financeCategories.direction, 'transit'), where))
    .get();
  return { inflow: row?.inflow ?? 0, outflow: row?.outflow ?? 0 };
}

function accountsOf(db: DbOrTx, year: ReportYear): CashReport['accounts'] {
  const before = dayBefore(year.startsOn);
  const opening = new Map(accountBalancesAt(db, before).map((a) => [a.accountId, a.balanceCents]));
  const closing = new Map(accountBalancesAt(db, year.endsOn).map((a) => [a.accountId, a.balanceCents]));
  const rows = new Map(db.select().from(financeAccounts).all().map((a) => [a.id, a]));
  // Dieselbe Kontenliste wie die Vermögensübersicht, auch Konten mit 0,00 (Designer Runde 7, 248/244).
  return reportAccountIdsInternal(db, { from: year.startsOn, to: year.endsOn }).map((id) => {
    const a = rows.get(id)!;
    const openedInYear = a.openingBalanceCents !== null && a.openingDate !== null && a.openingDate >= year.startsOn && a.openingDate <= year.endsOn ? a.openingBalanceCents : 0;
    return { accountId: a.id, kind: a.kind as AccountKind, openingCents: opening.get(a.id) ?? 0, openedInYearCents: openedInYear, closingCents: closing.get(a.id) ?? 0 };
  });
}

function bindingsOf(db: DbOrTx, year: ReportYear): CashReport['bindings'] {
  const before = dayBefore(year.startsOn);
  const start = new Map(purposeBalancesAt(db, before).map((p) => [p.purposeId, p]));
  const purposes = purposeBalancesAt(db, year.endsOn)
    .map((end) => {
      const s = start.get(end.purposeId);
      const inflowCents = end.carryForwardCents - (s?.carryForwardCents ?? 0) + end.inflowCents - (s?.inflowCents ?? 0) + end.transfersInCents - (s?.transfersInCents ?? 0);
      const usedCents = end.outflowCents - (s?.outflowCents ?? 0) + end.transfersOutCents - (s?.transfersOutCents ?? 0);
      return { purposeId: end.purposeId, carryForwardCents: s?.balanceCents ?? 0, inflowCents, usedCents, closingCents: end.balanceCents };
    })
    .filter((p) => p.carryForwardCents !== 0 || p.inflowCents !== 0 || p.usedCents !== 0 || p.closingCents !== 0);

  const reserves = db
    .select()
    .from(financeReserves)
    .all()
    .map((reserve) => {
      const movements = db.select().from(financeReserveMovements).where(and(eq(financeReserveMovements.reserveId, reserve.id), lte(financeReserveMovements.movementDate, year.endsOn))).all();
      const inYear = movements.filter((m) => m.movementDate >= year.startsOn);
      const carriedInYear = reserve.carryForwardCents !== null && reserve.carryForwardDate !== null && reserve.carryForwardDate >= year.startsOn && reserve.carryForwardDate <= year.endsOn ? reserve.carryForwardCents : 0;
      return {
        reserveId: reserve.id,
        openingCents: reserveBalanceAt(reserve, movements, before),
        addedCents: carriedInYear + inYear.filter((m) => m.kind === 'allocate').reduce((s, m) => s + m.amountCents, 0),
        releasedCents: inYear.filter((m) => m.kind !== 'allocate').reduce((s, m) => s + m.amountCents, 0),
        closingCents: reserveBalanceAt(reserve, movements, year.endsOn),
      };
    })
    .filter((r) => r.openingCents !== 0 || r.addedCents !== 0 || r.releasedCents !== 0 || r.closingCents !== 0);
  return { purposes, reserves };
}

/**
 * Abschnitt 10: gruppiert nach Funktion und Art, mit Zahl der Personen — nie Namen. Vergütung: Zeilen auf einer
 * Kategorie mit Pauschale; Aufwandsersatz: aus einer Auslage; sonst „Sonstiges“.
 */
function organPaymentsOf(db: DbOrTx, year: ReportYear) {
  const rows = relatedPartyPaymentsInternal(db, { from: year.startsOn, to: year.endsOn });
  const kindOf = (r: (typeof rows)[number]) => (r.allowanceKind !== 'none' ? 'remuneration' : r.originKind === 'expenseClaim' ? 'reimbursement' : 'other');
  const groups = new Map<string, { role: 'board-member' | 'related-party'; kind: 'remuneration' | 'reimbursement' | 'other'; amountCents: number; persons: Set<string> }>();
  const remunerationByBoardMember = new Map<string, number>();
  for (const r of rows) {
    const kind = kindOf(r);
    const key = `${r.role}:${kind}`;
    const group = groups.get(key) ?? { role: r.role, kind, amountCents: 0, persons: new Set<string>() };
    group.amountCents += r.amountCents;
    group.persons.add(r.contactId);
    groups.set(key, group);
    if (kind === 'remuneration' && r.role === 'board-member') remunerationByBoardMember.set(r.contactId, (remunerationByBoardMember.get(r.contactId) ?? 0) + r.amountCents);
  }
  const order = (g: { role: string; kind: string }) => `${g.role === 'board-member' ? 0 : 1}${['remuneration', 'reimbursement', 'other'].indexOf(g.kind)}`;
  const organPayments = [...groups.values()].sort((a, b) => order(a).localeCompare(order(b))).map(({ persons, ...g }) => ({ ...g, personCount: persons.size }));
  const limit = valueAt(db, 'organMemberLiabilityLimit', year.endsOn);
  const limitCents = limit === null ? null : Number(limit);
  const over = limitCents === null ? 0 : [...remunerationByBoardMember.values()].filter((cents) => cents > limitCents).length;
  return { organPayments, organPersonsOverLiabilityLimit: over, organLiabilityLimitCents: limitCents };
}

/** Abschnitt 11: im Jahr angewandte Zuordnungskorrekturen an Buchungen früherer Geschäftsjahre. */
function priorYearCorrectionsOf(db: DbOrTx, year: ReportYear): CashReport['priorYearCorrections'] {
  return db
    .select({ entryId: financeEntries.id, entryNumber: financeEntries.number, designation: financeFiscalYears.designation, approvedAt: financeAllocationCorrections.approvedAt })
    .from(financeAllocationCorrections)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationCorrections.entryId))
    .innerJoin(financeFiscalYears, eq(financeFiscalYears.id, financeEntries.fiscalYearId))
    .where(and(eq(financeAllocationCorrections.state, 'applied'), lt(financeFiscalYears.endsOn, year.startsOn), gte(sql`substr(${financeAllocationCorrections.approvedAt}, 1, 10)`, year.startsOn), lte(sql`substr(${financeAllocationCorrections.approvedAt}, 1, 10)`, year.endsOn)))
    .all()
    .map((r) => ({ entryId: r.entryId, entryNumber: r.entryNumber ?? '', fiscalYearDesignation: r.designation, appliedOn: r.approvedAt!.slice(0, 10) }))
    .sort((a, b) => a.appliedOn.localeCompare(b.appliedOn) || a.entryNumber.localeCompare(b.entryNumber));
}

export function computeCashReport(db: DbOrTx, params: ReportParams): CashReport {
  const full = reportYearInternal(db, params.fiscalYearId!);
  // Rechenschaft C (Amtsübergabe): Zwischenbericht vom Jahresbeginn bis `date` — das Jahr endet für die Rechnung dort.
  const year = params.date ? { ...full, endsOn: params.date } : full;
  const income = computeIncomeStatementReport(db, { fiscalYearId: year.id }, params.date);
  const accounts = accountsOf(db, year);
  const opening = transitSums(db, lt(financeEntries.entryDate, year.startsOn));
  const inYear = transitSums(db, and(gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn)));
  const transitOpening = opening.inflow - opening.outflow;
  const transit = { openingCents: transitOpening, inflowCents: inYear.inflow, outflowCents: inYear.outflow, closingCents: transitOpening + inYear.inflow - inYear.outflow };

  const sum = (pick: (a: CashReport['accounts'][number]) => number) => accounts.reduce((s, a) => s + pick(a), 0);
  const probeOpening = sum((a) => a.openingCents);
  const openedInYear = sum((a) => a.openedInYearCents);
  const closing = sum((a) => a.closingCents);
  const transitChange = transit.closingCents - transit.openingCents;
  const probe = { openingCents: probeOpening, openedInYearCents: openedInYear, resultCents: income.resultCents, transitChangeCents: transitChange, closingCents: closing, differenceCents: closing - (probeOpening + openedInYear + income.resultCents + transitChange) };

  const overview = assetOverviewAt(db, year.endsOn);
  return {
    year,
    income,
    accounts,
    transit,
    probe,
    bindings: bindingsOf(db, year),
    openItems: { receivablesCents: overview.receivablesCents, payablesCents: overview.payablesCents },
    otherAssets: otherAssetsBlockInternal(db, year.endsOn),
    ...organPaymentsOf(db, year),
    priorYearCorrections: priorYearCorrectionsOf(db, year),
    ...withCarryOvers(priorYearCarryOversOf(db, year)),
    ...(params.date ? { interimUntil: params.date } : {}),
  };
}

/** Geschäftsjahr, wahlweise mit einem Tag darin (Zwischenbericht der Amtsübergabe). Ohne Tag wie bisher. */
const cashReportParamsSchema: z.ZodType<ReportParams> = z.object({ fiscalYearId: z.string().min(1), date: z.iso.date().optional() }).strict();

function checkYearAndInterimDate(db: DbOrTx, params: ReportParams): Failure | null {
  const unknown = checkYearOrDate(db, { fiscalYearId: params.fiscalYearId });
  if (unknown || params.date === undefined) return unknown;
  const year = reportYearInternal(db, params.fiscalYearId!);
  return params.date < year.startsOn || params.date > year.endsOn ? invalid([{ path: 'date', message: 'outsideFiscalYear' }]) : null;
}

const withCarryOvers = (rows: NonNullable<CashReport['priorYearCarryOvers']>) => (rows.length > 0 ? { priorYearCarryOvers: rows } : {});

/** „Kassenteil des Jahresberichts nach <Fundstelle>, vorgelegt vom Vorstand“ — die Fundstelle ist eine Einstellung. */
function paperSubtitle(ctx: ReportRenderContext): string {
  const reference = (ctx.labels['setting.statuteReference'] ?? '').trim();
  return `Kassenteil des Jahresberichts${reference ? ` nach ${reference}` : ''}, vorgelegt vom Vorstand`;
}

export const cashReportDefinition: ReportDefinition<CashReport> = {
  key: 'cashReport',
  group: 'assembly',
  personal: false,
  available: true,
  orientation: 'landscape',
  paramsSchema: cashReportParamsSchema,
  checkParams: checkYearAndInterimDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: computeCashReport,
  toTypst: cashReportTypst,
  titleKey: 'finance.reports.cashReport.title',
  paperTitle: 'Kassenbericht',
  paperSubtitle,
  finalizeBlock: (data) => (data.probe.differenceCents === 0 ? null : { code: 'reportProbeFails', params: { differenceCents: data.probe.differenceCents } }),
};
