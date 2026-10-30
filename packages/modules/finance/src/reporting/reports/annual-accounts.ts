import { todayIn, type DbOrTx } from '@kompass/core';
import { renderMarkdownTypst } from '@kompass/markdown';
import { and, desc, eq, gte, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { relatedPartyPaymentsInternal } from '../../allocation/people';
import { PARTNER_GRANT_CATEGORY_KEYS, type DonationPlatform } from '../../ledger/codes';
import { endowmentAtInternal } from '../../ledger/endowment';
import { accountBalancesAt, assetOverviewAt, projectBalances, purposeBalancesAt, type AccountKind, type Sphere } from '../../ledger/queries';
import { reserveBalancesAt } from '../../ledger/reserve-balances';
import { financeAccounts, financeAllocationLines, financeAuditReports, financeCategories, financeEntries, financeExpenseClaims, financePurposes, financeReports, financeReserves } from '../../schema';
import { reportTimeZone, zonedDayOf } from '../../zoned-days';
import { annualAccountsExplanationInternal } from '../annual-accounts-notes';
import { canonicalJson } from '../hash';
import { annualRevenueForGemInternal } from '../revenue';
import { releaseOfYearInternal } from '../stage';
import { annualAccountsNamingInternal } from '../annual-accounts-naming';
import type { ReleaseBasis, ReportComputeEnv, ReportDefinition, ReportFinalizeBlock, ReportLinesFilter, ReportParams } from '../types';
import { annualAccountsTypst, otherWorkInternal, type AnnualAccountsRenderExtra } from './annual-accounts-typst';
import { TIME_ZONE_SETTING } from '../../zoned-days';
import { otherAssetsBlockInternal } from './asset-overview';
import type { ReserveKind } from './reserve-statement';
import { INCOME_ROWS, incomeRowOf, type IncomeKind, type IncomeRow } from './annual-accounts-rows';
import { computeCashReport, type CashReport } from './cash-report';
import { checkYearOrDate, previousYearInternal, reportAccountIdsInternal, reportYearInternal, SPHERE_ORDER, yearParamsSchema, type ReportYear } from './common';

/**
 * Jahresrechnung — der Finanzteil des Jahresberichts (Spec 0.4.5 Teil J; ITZ 7, 8, 10). Rein: dieselben Buchungen,
 * dieselbe Erläuterung, dieselben Einstellungen → dieselben Daten. Namen (Spender, Projekte) stehen nie in den Daten,
 * nur IDs; ob ein Name erscheint, entscheidet das Rendern (`annualAccountsNamingInternal`). Ausgaben positiv.
 */

/** Ein Betrag mit Vorjahr (`null` ohne Vorjahr) und Anteil an der jeweiligen Summe in Zehntelprozent (`null` bei Summe 0). */
export interface Amount {
  cents: number;
  previousCents: number | null;
  sharePermille: number | null;
}

export interface AnnualAccounts {
  year: ReportYear;
  previous: { id: string; designation: string } | null;
  /** F2 Mittelherkunft. */
  income: {
    rows: ({ row: IncomeRow } & Amount)[];
    /** Unterzeile der Geldspenden „davon über Spendenplattformen“; `null`, wenn in beiden Jahren 0. */
    viaPlatforms: Amount | null;
    bySphere: ({ sphere: Sphere } & Amount)[];
    total: Amount;
  };
  /** F3 Mittelverwendung. */
  expense: {
    program: { projects: ({ projectId: string | null } & Amount)[]; total: Amount; partnerForwarding: Amount; auxiliaries: Amount };
    fundraising: Amount;
    administration: Amount;
    /** Nenner der Kennzahlen (DZI): Ausgaben des ideellen Bereichs und der Zweckbetriebe. */
    idealAndPurposeTotal: Amount;
    assetManagement: Amount;
    business: Amount;
    total: Amount;
  };
  /** F4 Ergebnis und Probe (wie Kassenbericht). */
  result: { incomeCents: number; expenseCents: number; resultCents: number; previous: { incomeCents: number; expenseCents: number; resultCents: number } | null; probe: CashReport['probe'] };
  /** F1 Auf einen Blick. */
  glance: { incomeCents: number; expenseCents: number; resultCents: number; netAssetsCents: number; programCentsPerEuro: number | null };
  /** F5 Vermögen am Jahresende. Konten mit Art (das Papier nennt die Art, nie die Bezeichnung, Ve-L-7). */
  assets: {
    accounts: { accountId: string; kind: AccountKind; cents: number }[];
    accountsCents: number;
    receivablesCents: number;
    payablesCents: number;
    otherAssetsCents: number;
    otherLiabilitiesCents: number;
    netAssetsCents: number;
    earmarkedCents: number;
    /** Je Art der tatsächliche Abzug: eine Rücklage mit Zweck nur, soweit sie über dem Zweckbestand liegt (wie die Vermögensübersicht). */
    reserves: { kind: ReserveKind; cents: number }[];
    endowmentCents: number;
    remainingCents: number;
  };
  /** F6 Projekte: Einnahmen und Ausgaben am Projekt im Jahr, Zweckbestand seiner Zwecke am Jahresende. IDs, keine Namen. */
  projects: { projectId: string; incomeCents: number; expenseCents: number; purposeClosingCents: number }[];
  /** F7 Werbe- und Verwaltungsquote. */
  ratios: { overheadPermille: number | null };
  /** F7 Vergütungen an den Vorstand je Art: Empfänger, Summe erst ab drei Empfängern (kein Einzelbetrag in den Daten). */
  remuneration: { kind: 'remuneration' | 'volunteerAllowance'; recipients: number; amountCents: number | null }[];
  /** Zahlungen an Vorstandsmitglieder mit Pauschalen-Art ohne Grundlage in der Satzung (AEAO zu § 55 Nr. 25). */
  remunerationWithoutBasis: number;
  /**
   * F8 Zuwender über 10 % der Einnahmen. IDs; ob ein Name erscheint, entscheidet das Rendern. `null` nur in der
   * Ausgabe für Leser ohne `finance.read` bei Unbenannten (`redactWithoutRead`) — dann bleibt nur die Bandbreite.
   */
  majorDonors: { contactId: string | null; amountCents: number | null; sharePermille: number | null; bandFromPercent: number; platform: boolean }[];
  /** F9 Erläuterung, Prüfung, Kassenbericht. */
  notes: {
    explanation: string | null;
    audit: { basis: ReleaseBasis; auditReportFiledOn: string | null } | null;
    cashReport: { documentNumber: string; finalizedOn: string } | null;
  };
  /** Nur für die Bildschirmansicht — das Papier liest es nie. */
  screen: {
    over25: { section: 'income' | 'expense'; key: string; sharePermille: number }[];
    operationsLoss: ('business' | 'assetManagement')[];
    aeaoCostRatio: { costsCents: number; revenueCents: number; permille: number | null };
    gemReconciliation: { incomeCents: number; assetSalesCents: number; taxRefundsCents: number; gemLine9Cents: number; differenceCents: number };
  };
}

interface Line {
  amountCents: number;
  direction: 'income' | 'expense';
  sphere: Sphere;
  incomeKind: IncomeKind | null;
  costFunction: 'program' | 'administration' | 'fundraising' | null;
  donationPlatform: DonationPlatform | null;
  categoryKey: string;
  projectId: string | null;
  contactId: string | null;
  entryId: string;
}

/** Festgeschriebene Zeilen auf Einnahmen- und Ausgabenkategorien im Zeitraum (wie `incomeStatement`, ohne Durchlauf). */
export function annualAccountsLinesInternal(db: DbOrTx, range: { from: string; to: string }): Line[] {
  return db
    .select({
      amountCents: financeAllocationLines.amountCents,
      direction: financeCategories.direction,
      sphere: financeCategories.sphere,
      incomeKind: financeCategories.incomeKind,
      costFunction: financeCategories.costFunction,
      donationPlatform: financeCategories.donationPlatform,
      categoryKey: financeCategories.key,
      projectId: financeAllocationLines.projectId,
      contactId: financeAllocationLines.contactId,
      entryId: financeAllocationLines.entryId,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, range.from), lte(financeEntries.entryDate, range.to), ne(financeCategories.direction, 'transit'), isNotNull(financeCategories.sphere)))
    .all() as Line[];
}

/** Buchungen von Aufwandsspenden mit bestandener Prüfung (Plan J1, Entscheidung 8): freigegeben nur mit allen Prüfungen. */
export function passedWaiverEntryIdsInternal(db: DbOrTx): Set<string> {
  const rows = db
    .select({ entryId: financeExpenseClaims.entryId })
    .from(financeExpenseClaims)
    .where(and(eq(financeExpenseClaims.waiver, true), isNotNull(financeExpenseClaims.waiverSignedDocumentId), isNotNull(financeExpenseClaims.entryId)))
    .all();
  return new Set(rows.map((r) => r.entryId!));
}

const permille = (cents: number, total: number): number | null => (total === 0 ? null : Math.round((cents * 1000) / total));
const amountOf = (cents: number, previousCents: number | null, total: number): Amount => ({ cents, previousCents, sharePermille: permille(cents, total) });
const sumOf = (lines: readonly Line[], pick: (l: Line) => boolean, sign = 1) => lines.reduce((s, l) => (pick(l) ? s + sign * l.amountCents : s), 0);

const IN_PROGRAM_SPHERES: readonly Sphere[] = ['ideal', 'purposeOperation'];
/** Ausgaben ohne Kostenart (gibt es nach den Kategorie-Regeln nicht) zählen als Verwaltung — die Partition bleibt. */
const costFunctionOf = (l: Line) => l.costFunction ?? 'administration';

interface YearFigures {
  income: Map<IncomeRow, number>;
  viaPlatforms: number;
  bySphere: Map<Sphere, number>;
  incomeTotal: number;
  projects: Map<string | null, number>;
  program: number;
  partnerForwarding: number;
  auxiliaries: number;
  fundraising: number;
  administration: number;
  assetManagement: number;
  business: number;
  expenseTotal: number;
}

function figuresOf(lines: readonly Line[], passed: ReadonlySet<string>): YearFigures {
  const income = lines.filter((l) => l.direction === 'income');
  const expense = lines.filter((l) => l.direction === 'expense');
  const rowOf = (l: Line) => incomeRowOf({ incomeKind: l.incomeKind, sphere: l.sphere, donationPlatform: l.donationPlatform, waiverPassed: passed.has(l.entryId) });
  const byRow = new Map<IncomeRow, number>();
  for (const l of income) byRow.set(rowOf(l), (byRow.get(rowOf(l)) ?? 0) + l.amountCents);
  const bySphere = new Map<Sphere, number>();
  for (const l of income) bySphere.set(l.sphere, (bySphere.get(l.sphere) ?? 0) + l.amountCents);
  const inProgramSphere = (l: Line) => IN_PROGRAM_SPHERES.includes(l.sphere);
  const program = expense.filter((l) => inProgramSphere(l) && costFunctionOf(l) === 'program');
  const projects = new Map<string | null, number>();
  for (const l of program) projects.set(l.projectId, (projects.get(l.projectId) ?? 0) - l.amountCents);
  return {
    income: byRow,
    viaPlatforms: sumOf(income, (l) => l.donationPlatform !== null),
    bySphere,
    incomeTotal: sumOf(income, () => true),
    projects,
    program: sumOf(program, () => true, -1),
    partnerForwarding: sumOf(program, (l) => l.categoryKey === PARTNER_GRANT_CATEGORY_KEYS[0], -1),
    auxiliaries: sumOf(program, (l) => l.categoryKey === PARTNER_GRANT_CATEGORY_KEYS[1], -1),
    fundraising: sumOf(expense, (l) => inProgramSphere(l) && costFunctionOf(l) === 'fundraising', -1),
    administration: sumOf(expense, (l) => inProgramSphere(l) && costFunctionOf(l) === 'administration', -1),
    assetManagement: sumOf(expense, (l) => l.sphere === 'assetManagement', -1),
    business: sumOf(expense, (l) => l.sphere === 'business', -1),
    expenseTotal: sumOf(expense, () => true, -1),
  };
}

function assetsOf(db: DbOrTx, date: string, from: string): AnnualAccounts['assets'] {
  const overview = assetOverviewAt(db, date);
  const kinds = new Map(db.select({ id: financeAccounts.id, kind: financeAccounts.kind }).from(financeAccounts).all().map((a) => [a.id, a.kind as AccountKind]));
  const balances = new Map(accountBalancesAt(db, date).map((a) => [a.accountId, a.balanceCents]));
  const accounts = reportAccountIdsInternal(db, { from, to: date }).map((accountId) => ({ accountId, kind: kinds.get(accountId)!, cents: balances.get(accountId) ?? 0 }));
  const accountsCents = overview.accounts.reduce((s, a) => s + a.balanceCents, 0);
  const other = otherAssetsBlockInternal(db, date);
  const netAssetsCents = accountsCents + overview.receivablesCents - overview.payablesCents + other.assetsCents - other.liabilitiesCents;
  // Wie `assetOverviewAt`: eine Rücklage mit Zweck zählt nur über dem Zweckbestand (kein Doppelabzug).
  const purposeBalance = new Map(purposeBalancesAt(db, date).map((p) => [p.purposeId, p.balanceCents]));
  const reserveBalance = new Map(reserveBalancesAt(db, date).map((r) => [r.reserveId, r.balanceCents]));
  const byKind = new Map<ReserveKind, number>();
  for (const reserve of db.select().from(financeReserves).all()) {
    const balance = reserveBalance.get(reserve.id) ?? 0;
    const counted = reserve.purposeId ? Math.max(0, balance - Math.max(0, purposeBalance.get(reserve.purposeId) ?? 0)) : Math.max(0, balance);
    byKind.set(reserve.kind, (byKind.get(reserve.kind) ?? 0) + counted);
  }
  const reserves = [...byKind].filter(([, cents]) => cents !== 0).map(([kind, cents]) => ({ kind, cents }));
  const endowmentCents = endowmentAtInternal(db, date);
  const remainingCents = netAssetsCents - overview.earmarkedCents - reserves.reduce((s, r) => s + r.cents, 0) - endowmentCents;
  return { accounts, accountsCents, receivablesCents: overview.receivablesCents, payablesCents: overview.payablesCents, otherAssetsCents: other.assetsCents, otherLiabilitiesCents: other.liabilitiesCents, netAssetsCents, earmarkedCents: overview.earmarkedCents, reserves, endowmentCents, remainingCents };
}

function projectsOf(db: DbOrTx, year: ReportYear): AnnualAccounts['projects'] {
  const purposesByProject = new Map<string, string[]>();
  for (const p of db.select({ id: financePurposes.id, projectId: financePurposes.projectId }).from(financePurposes).all()) {
    if (p.projectId) purposesByProject.set(p.projectId, [...(purposesByProject.get(p.projectId) ?? []), p.id]);
  }
  const closing = new Map(purposeBalancesAt(db, year.endsOn).map((p) => [p.purposeId, p.balanceCents]));
  const balances = new Map(projectBalances(db, { from: year.startsOn, to: year.endsOn }).map((b) => [b.projectId, b]));
  const ids = [...new Set([...balances.keys(), ...purposesByProject.keys()])];
  return ids
    .map((projectId) => ({
      projectId,
      incomeCents: balances.get(projectId)?.incomeCents ?? 0,
      expenseCents: balances.get(projectId)?.expenseCents ?? 0,
      purposeClosingCents: (purposesByProject.get(projectId) ?? []).reduce((s, id) => s + (closing.get(id) ?? 0), 0),
    }))
    .filter((p) => p.incomeCents !== 0 || p.expenseCents !== 0 || p.purposeClosingCents !== 0)
    .sort((a, b) => b.expenseCents - a.expenseCents || a.projectId.localeCompare(b.projectId));
}

/** F7: nur die Rolle Vorstandsmitglied, Pauschalen-Arten `trainer` (Vergütung) und `volunteer` (Ehrenamtspauschale). */
function remunerationOf(db: DbOrTx, year: ReportYear, env: ReportComputeEnv): Pick<AnnualAccounts, 'remuneration' | 'remunerationWithoutBasis'> {
  const boardBasisFrom = env.settings['finance.boardRemunerationAllowed'] === true ? ((env.settings['finance.boardRemunerationValidFrom'] as string | null | undefined) ?? null) : null;
  const rows = relatedPartyPaymentsInternal(db, { from: year.startsOn, to: year.endsOn, boardBasisFrom }).filter((r) => r.role === 'board-member' && r.allowanceKind !== 'none');
  // Saldiert je Person und Art: eine Rückbuchung oder Erstattung hebt die Zahlung auf (Review J1).
  const netByContact = (list: readonly typeof rows[number][]) => {
    const net = new Map<string, number>();
    for (const r of list) net.set(r.contactId, (net.get(r.contactId) ?? 0) + r.paidCents);
    return [...net.values()].filter((cents) => cents > 0);
  };
  const remuneration = (['remuneration', 'volunteerAllowance'] as const).map((kind) => {
    const paid = netByContact(rows.filter((r) => (kind === 'remuneration' ? r.allowanceKind === 'trainer' : r.allowanceKind === 'volunteer')));
    return { kind, recipients: paid.length, amountCents: paid.length >= 3 ? paid.reduce((s, c) => s + c, 0) : null };
  });
  // Personen, an die ohne Grundlage per Saldo etwas gezahlt ist.
  return { remuneration, remunerationWithoutBasis: netByContact(rows.filter((r) => r.boardAllowanceWithoutBasis)).length };
}

/** F8: Zuflüsse je Kontakt (alle Einnahmezeilen mit Kontakt) über 10 % der Einnahmen des Jahres. */
function majorDonorsOf(lines: readonly Line[], incomeTotal: number): AnnualAccounts['majorDonors'] {
  if (incomeTotal <= 0) return [];
  const byContact = new Map<string, { amountCents: number; platform: boolean }>();
  for (const l of lines) {
    if (l.direction !== 'income' || l.contactId === null) continue;
    const known = byContact.get(l.contactId) ?? { amountCents: 0, platform: false };
    known.amountCents += l.amountCents;
    known.platform ||= l.donationPlatform === 'confirmsItself';
    byContact.set(l.contactId, known);
  }
  return [...byContact]
    .filter(([, v]) => v.amountCents * 10 > incomeTotal)
    .map(([contactId, v]) => ({ contactId, amountCents: v.amountCents, sharePermille: Math.round((v.amountCents * 1000) / incomeTotal), bandFromPercent: Math.floor((v.amountCents * 10) / incomeTotal) * 10, platform: v.platform }))
    .sort((a, b) => b.amountCents - a.amountCents || a.contactId.localeCompare(b.contactId));
}

function notesOf(db: DbOrTx, year: ReportYear, timeZone: string): AnnualAccounts['notes'] {
  const release = releaseOfYearInternal(db, year.id);
  const filed =
    release?.basis === 'auditReport'
      ? db.select({ filedAt: financeAuditReports.filedAt }).from(financeAuditReports).where(and(eq(financeAuditReports.fiscalYearId, year.id), eq(financeAuditReports.state, 'filed'))).orderBy(desc(financeAuditReports.filedAt), desc(financeAuditReports.id)).get()
      : undefined;
  const cash = db
    .select({ documentNumber: financeReports.documentNumber, finalizedAt: financeReports.finalizedAt })
    .from(financeReports)
    .where(and(eq(financeReports.reportKey, 'cashReport'), eq(financeReports.params, canonicalJson({ fiscalYearId: year.id })), isNull(financeReports.voidedAt)))
    .orderBy(desc(financeReports.finalizedAt))
    .get();
  return {
    explanation: annualAccountsExplanationInternal(db, year.id)?.text ?? null,
    audit: release ? { basis: release.basis, auditReportFiledOn: filed?.filedAt ? zonedDayOf(filed.filedAt, timeZone) : null } : null,
    cashReport: cash ? { documentNumber: cash.documentNumber, finalizedOn: zonedDayOf(cash.finalizedAt, timeZone) } : null,
  };
}

function screenOf(db: DbOrTx, year: ReportYear, data: Pick<AnnualAccounts, 'income' | 'expense'>): AnnualAccounts['screen'] {
  const over = (sharePermille: number | null) => sharePermille !== null && sharePermille > 250;
  // Nur Sammelposten (Joe 2026-10-28): „Sonstiges“, übrige Satzungsarbeit, Werbung, Verwaltung — sie verbergen, woher
  // das Geld kommt oder wofür es ausgegeben wurde. Eine benannte Einnahmeart oder ein Projekt sagt es schon selbst.
  // „übrige Satzungsarbeit“ hängt daran, welche Projekte publiziert sind — das kommt erst in der Ausgabe dazu
  // (`decorateOutput`), nie in den Hash.
  const over25: AnnualAccounts['screen']['over25'] = [
    ...data.income.rows.filter((r) => r.row === 'other' && over(r.sharePermille)).map((r) => ({ section: 'income' as const, key: r.row, sharePermille: r.sharePermille! })),
    ...(['fundraising', 'administration'] as const).filter((k) => over(data.expense[k].sharePermille)).map((k) => ({ section: 'expense' as const, key: k, sharePermille: data.expense[k].sharePermille! })),
  ];
  const incomeOf = (sphere: Sphere) => data.income.bySphere.find((s) => s.sphere === sphere)?.cents ?? 0;
  const operationsLoss = (['business', 'assetManagement'] as const).filter((sphere) => incomeOf(sphere) - data.expense[sphere].cents < 0);
  const revenue = annualRevenueForGemInternal(db, year.id);
  const part = (key: string) => revenue.parts.find((p) => p.key === key)?.cents ?? 0;
  const costsCents = data.expense.fundraising.cents + data.expense.administration.cents;
  const incomeCents = data.income.total.cents;
  return {
    over25,
    operationsLoss,
    aeaoCostRatio: { costsCents, revenueCents: revenue.totalCents, permille: permille(costsCents, revenue.totalCents) },
    gemReconciliation: { incomeCents, assetSalesCents: part('assetSales'), taxRefundsCents: part('taxRefunds'), gemLine9Cents: revenue.totalCents, differenceCents: incomeCents - part('assetSales') - part('taxRefunds') - revenue.totalCents },
  };
}

export function computeAnnualAccounts(db: DbOrTx, params: ReportParams, env: ReportComputeEnv): AnnualAccounts {
  const year = reportYearInternal(db, params.fiscalYearId!);
  const previousYear = previousYearInternal(db, year);
  const passed = passedWaiverEntryIdsInternal(db);
  const lines = annualAccountsLinesInternal(db, { from: year.startsOn, to: year.endsOn });
  const now = figuresOf(lines, passed);
  const before = previousYear ? figuresOf(annualAccountsLinesInternal(db, { from: previousYear.startsOn, to: previousYear.endsOn }), passed) : null;
  const prev = (pick: (y: YearFigures) => number): number | null => (before ? pick(before) : null);
  const income = (pick: (y: YearFigures) => number) => amountOf(pick(now), prev(pick), now.incomeTotal);
  const expense = (pick: (y: YearFigures) => number) => amountOf(pick(now), prev(pick), now.expenseTotal);

  const rows = INCOME_ROWS.map((row) => ({ row, ...income((y) => y.income.get(row) ?? 0) })).filter((r) => r.row !== 'courtFines' || r.cents !== 0 || (r.previousCents ?? 0) !== 0);
  const viaPlatforms = now.viaPlatforms !== 0 || (before?.viaPlatforms ?? 0) !== 0 ? income((y) => y.viaPlatforms) : null;
  const bySphere = SPHERE_ORDER.filter((s) => now.bySphere.has(s) || before?.bySphere.has(s)).map((sphere) => ({ sphere, ...income((y) => y.bySphere.get(sphere) ?? 0) }));
  const projectIds = [...new Set([...now.projects.keys(), ...(before?.projects.keys() ?? [])])];
  const projects = projectIds
    .map((projectId) => ({ projectId, ...expense((y) => y.projects.get(projectId) ?? 0) }))
    .sort((a, b) => b.cents - a.cents || (a.projectId ?? '').localeCompare(b.projectId ?? ''));
  const idealAndPurpose = (y: YearFigures) => y.program + y.fundraising + y.administration;
  const idealAndPurposeNow = idealAndPurpose(now);
  const probe = computeCashReport(db, { fiscalYearId: year.id }, env).probe;
  const assets = assetsOf(db, year.endsOn, year.startsOn);
  const incomeBlock: AnnualAccounts['income'] = { rows, viaPlatforms, bySphere, total: income((y) => y.incomeTotal) };
  const expenseBlock: AnnualAccounts['expense'] = {
    program: { projects, total: expense((y) => y.program), partnerForwarding: expense((y) => y.partnerForwarding), auxiliaries: expense((y) => y.auxiliaries) },
    fundraising: expense((y) => y.fundraising),
    administration: expense((y) => y.administration),
    idealAndPurposeTotal: expense(idealAndPurpose),
    assetManagement: expense((y) => y.assetManagement),
    business: expense((y) => y.business),
    total: expense((y) => y.expenseTotal),
  };

  return {
    year,
    previous: previousYear ? { id: previousYear.id, designation: previousYear.designation } : null,
    income: incomeBlock,
    expense: expenseBlock,
    result: {
      incomeCents: now.incomeTotal,
      expenseCents: now.expenseTotal,
      resultCents: now.incomeTotal - now.expenseTotal,
      previous: before ? { incomeCents: before.incomeTotal, expenseCents: before.expenseTotal, resultCents: before.incomeTotal - before.expenseTotal } : null,
      probe,
    },
    glance: {
      incomeCents: now.incomeTotal,
      expenseCents: now.expenseTotal,
      resultCents: now.incomeTotal - now.expenseTotal,
      netAssetsCents: assets.netAssetsCents,
      programCentsPerEuro: idealAndPurposeNow === 0 ? null : Math.round((now.program * 100) / idealAndPurposeNow),
    },
    assets,
    projects: projectsOf(db, year),
    ratios: { overheadPermille: permille(now.fundraising + now.administration, idealAndPurposeNow) },
    ...remunerationOf(db, year, env),
    majorDonors: majorDonorsOf(lines, now.incomeTotal),
    notes: notesOf(db, year, reportTimeZone(env)),
    screen: screenOf(db, year, { income: incomeBlock, expense: expenseBlock }),
  };
}

/** Je Summe die Zeilen für `finance_lines_list`, wo Richtung und Bereich sie eindeutig fassen. */
function linesFilter(data: AnnualAccounts): Record<string, ReportLinesFilter> {
  const fiscalYearId = data.year.id;
  return {
    income: { fiscalYearId, direction: 'income' },
    expense: { fiscalYearId, direction: 'expense' },
    ...Object.fromEntries(data.income.bySphere.map((s) => [`income.${s.sphere}`, { fiscalYearId, direction: 'income' as const, sphere: s.sphere }])),
    'expense.assetManagement': { fiscalYearId, direction: 'expense', sphere: 'assetManagement' },
    'expense.business': { fiscalYearId, direction: 'expense', sphere: 'business' },
  };
}

/**
 * Jahresrechnung im Katalog (Spec 0.4.5 Teil J): Gruppe Öffentlichkeit (braucht die Freigabe der Kassenprüfung),
 * ohne Personenbezug. Festschreiben erst nach der Probe und dem Kassenbericht desselben Jahres; Vergütung an den Vorstand
 * ohne Grundlage verlangt eine Bestätigung mit Begründung (Planreview J1). Namen und Anhang kommen beim Rendern dazu.
 */
export const annualAccountsReport: ReportDefinition<AnnualAccounts> = {
  key: 'annualAccounts',
  group: 'public',
  personal: false,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearParamsSchema,
  checkParams: checkYearOrDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  settingKeys: [TIME_ZONE_SETTING, 'finance.boardRemunerationAllowed', 'finance.boardRemunerationValidFrom'],
  compute: computeAnnualAccounts,
  toTypst: annualAccountsTypst,
  titleKey: 'finance.reports.annualAccounts.title',
  paperTitle: 'Jahresrechnung',
  paperSubtitle: () => 'Finanzteil des Jahresberichts',
  async prepareRender(deps, data, opts) {
    const extra: AnnualAccountsRenderExtra = {
      naming: annualAccountsNamingInternal(deps.db, data, opts.at ?? todayIn(deps), opts.annex?.anonymize ?? [], deps.locales()[0] ?? 'de'),
      explanationTypst: data.notes.explanation ? await renderMarkdownTypst(data.notes.explanation) : '',
      annex: opts.annex ?? {},
    };
    return extra as unknown as Record<string, unknown>;
  },
  finalizeBlock: (data): ReportFinalizeBlock | null => {
    if (data.result.probe.differenceCents !== 0) return { code: 'reportProbeFails', params: { differenceCents: data.result.probe.differenceCents } };
    if (data.notes.cashReport === null) return { code: 'annualAccountsCashReportMissing', params: { designation: data.year.designation } };
    return null;
  },
  // Hinweis „übrige Satzungsarbeit über 25 %“ wie F3 des Papiers: ohne Projekt plus nicht publizierte Projekte, zum Tag
  // des Aufrufs (Abnahme B1, Nachzug 1). Nur Ausgabe, nicht im Hash.
  decorateOutput: (deps, data) => {
    const naming = annualAccountsNamingInternal(deps.db, data, todayIn(deps), [], deps.locales()[0] ?? 'de');
    const otherWork = otherWorkInternal(data.expense, naming.projects);
    if (!otherWork || otherWork.sharePermille === null || otherWork.sharePermille <= 250) return data;
    const item = { section: 'expense' as const, key: 'project:none', sharePermille: otherWork.sharePermille };
    const at = data.screen.over25.findIndex((o) => o.section === 'expense');
    const over25 = at < 0 ? [...data.screen.over25, item] : [...data.screen.over25.slice(0, at), item, ...data.screen.over25.slice(at)];
    return { ...data, screen: { ...data.screen, over25 } };
  },
  // Ohne `finance.read` (Personenbezug): Zuwender, die das Papier nicht nennt, nur mit Bandbreite — keine ID, kein Betrag.
  redactWithoutRead: (deps, data) => {
    const naming = annualAccountsNamingInternal(deps.db, data, todayIn(deps), [], deps.locales()[0] ?? 'de');
    return { ...data, majorDonors: data.majorDonors.map((d) => (d.contactId && naming.donors[d.contactId] ? d : { contactId: null, amountCents: null, sharePermille: null, bandFromPercent: d.bandFromPercent, platform: d.platform })) };
  },
  confirmToFinalize: (data) => (data.remunerationWithoutBasis > 0 ? { code: 'annualAccountsRemunerationWithoutBasis', params: { count: data.remunerationWithoutBasis } } : null),
  linesFilter,
};
