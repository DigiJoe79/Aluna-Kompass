import { notFound, type DbOrTx, type Failure } from '@kompass/core';
import { and, eq, gte, lte } from 'drizzle-orm';
import { donationReconciliationInternal } from '../../donations/book';
import type { Sphere } from '../../ledger/queries';
import { taxPeriodInternal } from '../../ledger/tax-periods';
import { financeAllocationLines, financeCategories, financeEntries } from '../../schema';
import type { ReportComputeEnv, ReportDefinition, ReportParams } from '../types';
import { amountCell, countCell, emptyCell, heading, paragraph, reportYearInternal, SPHERE_ORDER, SPHERE_TITLE, spanRow, strongAmountCell, strongCell, table, textCell, unitLine, type ReportYear } from './common';
import { taxPeriodParamsForYear, taxPeriodParamsSchema, yearsOfTaxPeriod } from './tax-return-gem';

/**
 * EÜR für das Finanzamt (Spec § D2, Plan D2 Task 6): Beilage der Steuererklärung — je Jahr des Erklärungszeitraums und
 * Bereich die Einnahmen nach den Posten des Zusatzblatts der Finanzämter (Muster Rheinland-Pfalz, Recherche A4),
 * Ausgaben und Ergebnis; nachrichtlich Übungsleiter (Summe und Anzahl Personen, keine Namen — die Namensliste ist die
 * Personenübersicht), Mitglieder am Jahresende (Angabe am Zeitraum) und die Summe der bestätigten Zuwendungen.
 * Plattform-Auszahlungen sind Zuwendungen anderer Organisationen (`bodyGrant`). Ohne Personenbezug.
 */

export type TaxIncomePost =
  | 'membershipFees' | 'donations' | 'grants' | 'otherIdeal'
  | 'interest' | 'rent' | 'otherAssetManagement'
  | 'fees' | 'otherPurposeOperation'
  | 'sales' | 'sponsoring' | 'otherBusiness';

/** Posten je Bereich in fester Reihenfolge; der letzte nimmt den Rest. */
const POSTS: Record<Sphere, readonly { post: TaxIncomePost; kinds: readonly string[] }[]> = {
  ideal: [{ post: 'membershipFees', kinds: ['membershipFee'] }, { post: 'donations', kinds: ['donation', 'inKindDonation', 'expenseWaiver'] }, { post: 'grants', kinds: ['publicGrant', 'bodyGrant'] }, { post: 'otherIdeal', kinds: [] }],
  assetManagement: [{ post: 'interest', kinds: ['interest'] }, { post: 'rent', kinds: ['rent'] }, { post: 'otherAssetManagement', kinds: [] }],
  purposeOperation: [{ post: 'fees', kinds: ['fees'] }, { post: 'otherPurposeOperation', kinds: [] }],
  business: [{ post: 'sales', kinds: ['sales'] }, { post: 'sponsoring', kinds: ['sponsoring'] }, { post: 'otherBusiness', kinds: [] }],
};

export interface TaxIncomeStatementSphere {
  sphere: Sphere;
  income: { post: TaxIncomePost; cents: number }[];
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
}
export interface TaxIncomeStatementYear {
  fiscalYearId: string;
  spheres: TaxIncomeStatementSphere[];
  trainer: { persons: number; cents: number };
  memberCount: number | null;
  confirmedCents: number;
}
export interface TaxReturnIncomeStatementReport {
  taxPeriodId: string;
  years: ReportYear[];
  perYear: TaxIncomeStatementYear[];
}

const FEES_KEY = 'finance.membershipFeesCertifiable';
const MINIMUM_KEY = 'finance.batchMinimumCents';

function checkParams(db: DbOrTx, params: ReportParams): Failure | null {
  return taxPeriodInternal(db, params.taxPeriodId ?? '') ? null : notFound('financeTaxPeriod', params.taxPeriodId ?? '');
}

function yearOf(db: DbOrTx, year: ReportYear, memberCount: number | null, env: ReportComputeEnv): TaxIncomeStatementYear {
  const rows = db
    .select({ amountCents: financeAllocationLines.amountCents, contactId: financeAllocationLines.contactId, direction: financeCategories.direction, sphere: financeCategories.sphere, incomeKind: financeCategories.incomeKind, allowanceKind: financeCategories.allowanceKind })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn)))
    .all()
    .filter((r) => r.direction !== 'transit' && r.sphere !== null);
  const spheres = SPHERE_ORDER.map((sphere): TaxIncomeStatementSphere => {
    const own = rows.filter((r) => r.sphere === sphere);
    const income = own.filter((r) => r.direction === 'income');
    const posts = POSTS[sphere];
    const named = new Set(posts.flatMap((p) => p.kinds));
    const incomeByPost = posts.map((p) => ({ post: p.post, cents: income.filter((r) => (p.kinds.length > 0 ? p.kinds.includes(r.incomeKind ?? '') : !named.has(r.incomeKind ?? ''))).reduce((s, r) => s + r.amountCents, 0) }));
    const incomeCents = income.reduce((s, r) => s + r.amountCents, 0);
    const expenseCents = own.filter((r) => r.direction === 'expense').reduce((s, r) => s - r.amountCents, 0);
    return { sphere, income: incomeByPost, incomeCents, expenseCents, resultCents: incomeCents - expenseCents };
  });
  const trainer = rows.filter((r) => r.allowanceKind === 'trainer');
  const calendarYear = Number(year.endsOn.slice(0, 4));
  const feesCertifiable = env.settings[FEES_KEY] !== false;
  const minCents = typeof env.settings[MINIMUM_KEY] === 'number' ? (env.settings[MINIMUM_KEY] as number) : 0;
  return {
    fiscalYearId: year.id,
    spheres,
    trainer: { persons: new Set(trainer.map((r) => r.contactId).filter((id): id is string => id !== null)).size, cents: trainer.reduce((s, r) => s - r.amountCents, 0) },
    memberCount,
    confirmedCents: donationReconciliationInternal(db, calendarYear, { feesCertifiable, minCents, limitDate: `${calendarYear}-12-31` }).confirmedCents,
  };
}

export function computeTaxReturnIncomeStatementReport(db: DbOrTx, params: ReportParams, env: ReportComputeEnv): TaxReturnIncomeStatementReport {
  const period = taxPeriodInternal(db, params.taxPeriodId!)!;
  const years = period.fiscalYearIds.map((id) => reportYearInternal(db, id));
  return { taxPeriodId: period.id, years, perYear: years.map((y) => yearOf(db, y, period.answers.memberCounts?.[y.id] ?? null, env)) };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const POST_TEXT: Record<TaxIncomePost, string> = {
  membershipFees: 'Mitgliedsbeiträge',
  donations: 'Spenden (Geld, Sachen, Aufwand)',
  grants: 'Zuschüsse und Zuwendungen anderer Organisationen',
  otherIdeal: 'Sonstige Einnahmen',
  interest: 'Zinsen und Kapitalerträge',
  rent: 'Miete und Pacht',
  otherAssetManagement: 'Sonstige Einnahmen',
  fees: 'Entgelte',
  otherPurposeOperation: 'Sonstige Einnahmen',
  sales: 'Verkauf und Veranstaltungen',
  sponsoring: 'Sponsoring und Werbung',
  otherBusiness: 'Sonstige Einnahmen',
};

export function taxReturnIncomeStatementTypst(data: TaxReturnIncomeStatementReport): string {
  const n = data.years.length;
  const cols = `(1fr, ${Array.from({ length: n }, () => '34mm').join(', ')})`;
  const header = ['', ...data.years.map((y) => y.designation)];
  const right = data.years.map((_, i) => i + 1);
  const byYear = data.perYear;
  // Je Bereich eine Tabelle, die nicht umbricht: Eine Bereichsüberschrift steht nie allein am Seitenende (Designer
  // Runde 7, 320).
  const sphereTables = SPHERE_ORDER.map((sphere) => {
    const rows: string[][] = [[spanRow(n + 1, SPHERE_TITLE[sphere])]];
    const of = (y: TaxIncomeStatementYear) => y.spheres.find((s) => s.sphere === sphere)!;
    for (const { post } of POSTS[sphere]) rows.push([textCell(POST_TEXT[post]), ...byYear.map((y) => amountCell(of(y).income.find((p) => p.post === post)!.cents))]);
    rows.push([strongCell('Einnahmen'), ...byYear.map((y) => strongAmountCell(of(y).incomeCents))]);
    rows.push([textCell('Ausgaben'), ...byYear.map((y) => amountCell(of(y).expenseCents))]);
    rows.push([strongCell('Überschuss oder Fehlbetrag'), ...byYear.map((y) => strongAmountCell(of(y).resultCents))]);
    return `#block(breakable: false)[\n${table(cols, header, rows, { rightHeads: right })}\n]`;
  });
  const memo: string[][] = [
    [textCell('Zahlungen an Übungsleiter'), ...byYear.map((y) => amountCell(y.trainer.cents))],
    [textCell('Übungsleiter, Anzahl Personen'), ...byYear.map((y) => countCell(y.trainer.persons))],
    [textCell('Mitglieder am Jahresende'), ...byYear.map((y) => (y.memberCount === null ? emptyCell : countCell(y.memberCount)))],
    [textCell('Bestätigte Zuwendungen (Kalenderjahr)'), ...byYear.map((y) => amountCell(y.confirmedCents))],
  ];
  return [
    heading(2, 'Einnahmen und Ausgaben je Bereich'),
    unitLine(),
    ...sphereTables,
    `#block(breakable: false)[\n${heading(2, 'Nachrichtlich')}\n\n${table(cols, header, memo, { rightHeads: right })}\n]`,
    paragraph('Die Namen der Übungsleiter nennt die Personenübersicht des Jahres.'),
  ].join('\n\n');
}

export const taxReturnIncomeStatementReport: ReportDefinition<TaxReturnIncomeStatementReport> = {
  key: 'taxReturnIncomeStatement',
  group: 'taxOffice',
  personal: false,
  available: true,
  orientation: 'landscape',
  paramsSchema: taxPeriodParamsSchema,
  checkParams,
  years: yearsOfTaxPeriod,
  paramsForYear: taxPeriodParamsForYear,
  settingKeys: [FEES_KEY, MINIMUM_KEY],
  compute: computeTaxReturnIncomeStatementReport,
  toTypst: taxReturnIncomeStatementTypst,
  titleKey: 'finance.reports.taxReturnIncomeStatement.title',
  paperTitle: 'EÜR für das Finanzamt',
  paperPeriod: (data) => {
    const first = data.years[0]?.designation ?? '';
    const last = data.years.at(-1)?.designation ?? '';
    return `Erklärungszeitraum ${first === last ? first : `${first}–${last}`}`;
  },
};
