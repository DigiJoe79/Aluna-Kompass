import { notFound, type DbOrTx, type Failure } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { contactTaxDetailsInternal } from '../../allocation/contact-tax-details';
import { foreignActivityInternal } from '../../allocation/foreign';
import { positionViewsOf, sumPositionCents } from '../../allocation/partner-proof';
import { valueAt } from '../../ledger/dated-values';
import { incomeStatement } from '../../ledger/queries';
import { reserveBalanceAt } from '../../ledger/reserve-balances';
import { taxContextAt } from '../../ledger/tax';
import { taxPeriodInternal, taxPeriodOfYearInternal, type GemAnswers } from '../../ledger/tax-periods';
import { vatReturnDueOnInternal, vatReturnRequiredInternal } from '../../ledger/vat-periods';
import { financeConflict } from '../../errors';
import { financeAllocationLines, financeCategories, financeEntries, financeNotices, financePartnerPayments, financePartnerProfiles, financeReserveMovements, financeReserves } from '../../schema';
import { assessmentYearOf, gemFormFor, type GemLine } from '../gem-forms';
import { annualRevenueForGemInternal, operationsResultInternal, operationsRevenueInternal, type AnnualRevenue } from '../revenue';
import { ao52PurposeOf } from '../../format/tax-purposes';
import type { ReportComputeEnv, ReportDefinition, ReportLinesFilter, ReportParams } from '../types';
import { reportTimeZone, TIME_ZONE_SETTING, zonedDayRange } from '../../zoned-days';
import { reportYearInternal, type ReportYear } from './common';
import { taxReturnGemTypst } from './tax-return-gem-typst';

/**
 * Werte für die Anlage Gem (Spec § D2, Plan D2 Task 5): je Zeile der Fassung des Veranlagungsjahres der Wert und seine
 * Herkunft, dazu die Beilagen (nur Schlüssel und Parameter) und Hinweise. In den Daten — und damit im Hash — stehen nur
 * Zeilennummer, Wert und Herkunft: kein Wortlaut (der kommt beim Rendern aus `gem-forms.ts`) und kein Zustand anderer
 * Berichte, sonst veraltete eine festgeschriebene Fassung, sobald eine Beilage festgeschrieben wird. Mit Personenbezug:
 * Zeilen 65, 70 und 75 nennen Organisationen und Freitext.
 */

type Row = Record<string, string | number | null>;
export type GemValue =
  | { kind: 'yearRange'; from: string; to: string }
  /** `parts` je Jahr für die Zusammensetzung (Board 15f); `parts` daneben bleibt die des letzten Jahres (Papier). */
  | { kind: 'amountPerYear'; perYear: { fiscalYearId: string; line: string; cents: number; parts: AnnualRevenue['parts'] }[]; parts: AnnualRevenue['parts'] }
  | { kind: 'amount'; cents: number }
  | { kind: 'yesNo'; value: boolean; cents?: number; limitCents?: number }
  | { kind: 'date'; value: string }
  | { kind: 'choice'; value: string }
  | { kind: 'text'; value: string }
  | { kind: 'list'; rows: Row[] }
  | { kind: 'elster' };
export type GemOrigin =
  | { kind: 'lines'; filterKey: string }
  | { kind: 'report'; report: string; params: ReportParams }
  | { kind: 'answer'; field: keyof GemAnswers }
  | { kind: 'notice' }
  | { kind: 'reserves' }
  | { kind: 'partnerPayments' };
export interface GemLineValue {
  line: string;
  value: GemValue | null;
  missing: boolean;
  origin?: GemOrigin;
}
export type GemHint =
  /** Je Jahr die Einnahmen der steuerpflichtigen wGB und die Grenze des § 64 Abs. 3 AO — der Abstand (Board 15f). */
  | { code: 'kst1FullyExempt'; years: { designation: string; cents: number; limitCents: number }[] }
  | { code: 'businessOverLimit'; designation: string; cents: number; limitCents: number }
  | { code: 'vatReturnRequired'; /** Kalenderjahr der USt-Jahreserklärung (E6a). */ year: number; /** Dieselbe Frist wie unter „Fristen und Schwellen“. */ dueOn: string }
  | { code: 'noVatReturnSmallBusiness' }
  | { code: 'timelyUse'; designation: string; cents: number; limitCents: number | null; required: boolean }
  | { code: 'gratuitousCandidates'; count: number; cents: number }
  | { code: 'businessCombined' }
  | { code: 'spheresMergeable' }
  | { code: 'endowmentNotToAssets'; count: number }
  | { code: 'revenueDefinition' }
  | { code: 'unverifiedLines' }
  | { code: 'formAssumed'; formYear: number };
export type GemAttachmentKey = 'taxReturnIncomeStatement' | 'assetOverview' | 'reserveStatement' | 'foreignActivity' | 'peopleOverview' | 'activityReport' | 'assemblyMinutes' | 'statute';
export interface GemAttachment {
  key: GemAttachmentKey;
  params?: ReportParams;
  fiscalYearId?: string;
}
export interface TaxReturnGemReport {
  taxPeriodId: string;
  years: ReportYear[];
  formYear: number;
  line10LimitCents: number;
  lines: GemLineValue[];
  attachments: GemAttachment[];
  hints: GemHint[];
  missingCount: number;
}

const COUNTRY_KEY = 'organization.country';
/** Hinweis-Kategorien des Startplans für Zeile 74 (unentgeltliche Zuwendungen außerhalb des Satzungszwecks). */
const GIFT_CATEGORY_KEYS = ['member-care', 'member-gifts'];

export const taxPeriodParamsSchema: z.ZodType<ReportParams> = z.object({ taxPeriodId: z.string().min(1) }).strict();

/** Unbekannter Zeitraum → `notFound`; ein Zeitraum, dessen Jahr vor der ersten Fassung endet → `gemFormMissing`. */
export function checkTaxPeriodParams(db: DbOrTx, params: ReportParams): Failure | null {
  const period = taxPeriodInternal(db, params.taxPeriodId ?? '');
  if (!period) return notFound('financeTaxPeriod', params.taxPeriodId ?? '');
  const year = assessmentYearOf(reportYearInternal(db, period.lastFiscalYearId).endsOn);
  return gemFormFor(year) ? null : financeConflict('gemFormMissing', { year: String(year) });
}

export const yearsOfTaxPeriod = (db: DbOrTx, params: ReportParams): string[] => taxPeriodInternal(db, params.taxPeriodId ?? '')?.fiscalYearIds ?? [];

/** Der Zeitraum, zu dem das Jahr gehört — als Parameter für die Seite „Berichte“; ohne Zeitraum keine Stufe. */
export function taxPeriodParamsForYear(db: DbOrTx, fiscalYearId: string): ReportParams | null {
  const period = taxPeriodOfYearInternal(db, fiscalYearId);
  return period ? { taxPeriodId: period.id } : null;
}

interface Context {
  db: DbOrTx;
  taxPeriodId: string;
  years: ReportYear[];
  first: ReportYear;
  last: ReportYear;
  answers: GemAnswers;
  formYear: number;
  limitCents: number;
  /** Die Zone des Vereins: Freigaben (Zeitstempel) zählen nach ihrem Tag dort (F-B3). */
  timeZone: string;
}

const inPeriod = (c: Context) => ({ from: c.first.startsOn, to: c.last.endsOn });

/** Festgeschriebene Zuordnungszeilen im Zeitraum mit Merkmal — nach Buchungsdatum. */
function linesWith(c: Context, where: ReturnType<typeof eq>) {
  return c.db
    .select({ id: financeAllocationLines.id, amountCents: financeAllocationLines.amountCents, contactId: financeAllocationLines.contactId, addsToAssets: financeAllocationLines.addsToAssets, entryDate: financeEntries.entryDate, direction: financeCategories.direction })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, inPeriod(c).from), lte(financeEntries.entryDate, inPeriod(c).to), where))
    .orderBy(asc(financeEntries.entryDate), asc(financeAllocationLines.id))
    .all();
}

const nameOf = (db: DbOrTx, contactId: string | null): string | null => {
  if (!contactId) return null;
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  return contact ? displayName(contact) : null;
};

function reservesAtEnd(c: Context) {
  const movements = c.db.select().from(financeReserveMovements).all();
  return c.db
    .select()
    .from(financeReserves)
    .orderBy(asc(financeReserves.createdAt), asc(financeReserves.id))
    .all()
    .map((reserve) => {
      const own = movements.filter((m) => m.reserveId === reserve.id);
      const inRange = own.filter((m) => m.movementDate >= c.first.startsOn && m.movementDate <= c.last.endsOn);
      return {
        reserve,
        balanceCents: reserveBalanceAt(reserve, own, c.last.endsOn),
        allocatedCents: inRange.filter((m) => m.kind === 'allocate').reduce((s, m) => s + m.amountCents, 0),
        dissolvedCents: inRange.filter((m) => m.kind === 'dissolve').reduce((s, m) => s + m.amountCents, 0),
        movedInRange: inRange.length > 0,
      };
    });
}

function endowmentsGiven(c: Context): Row[] {
  return c.db
    .select()
    .from(financePartnerPayments)
    .where(and(eq(financePartnerPayments.state, 'approved'), eq(financePartnerPayments.assetEndowment, true), gte(financePartnerPayments.approvedAt, zonedDayRange(c.first.startsOn, c.last.endsOn, c.timeZone).start), lt(financePartnerPayments.approvedAt, zonedDayRange(c.first.startsOn, c.last.endsOn, c.timeZone).end)))
    .orderBy(asc(financePartnerPayments.approvedAt), asc(financePartnerPayments.id))
    .all()
    .map((p) => {
      const contactId = c.db.select({ contactId: financePartnerProfiles.contactId }).from(financePartnerProfiles).where(eq(financePartnerProfiles.id, p.partnerId)).get()?.contactId ?? null;
      const details = contactId ? contactTaxDetailsInternal(c.db, contactId) : null;
      return { party: nameOf(c.db, contactId), contactId, taxOffice: details?.taxOffice ?? null, taxNumber: details?.taxNumber ?? null, purpose: ao52PurposeOf(details?.beneficiaryPurpose) ? details!.beneficiaryPurpose : null, amountCents: sumPositionCents(positionViewsOf(c.db, p.id)) };
    });
}

function endowmentsReceived(c: Context): { rows: Row[]; notToAssets: number } {
  const lines = linesWith(c, eq(financeAllocationLines.assetEndowment, true)).filter((l) => l.direction === 'income');
  const rows = lines.map((l) => {
    const details = l.contactId ? contactTaxDetailsInternal(c.db, l.contactId) : null;
    return { party: nameOf(c.db, l.contactId), contactId: l.contactId, taxOffice: details?.taxOffice ?? null, taxNumber: details?.taxNumber ?? null, purpose: ao52PurposeOf(details?.beneficiaryPurpose) ? details!.beneficiaryPurpose : null, amountCents: l.amountCents };
  });
  return { rows, notToAssets: lines.filter((l) => !l.addsToAssets).length };
}

const PARTY_CELLS = ['party', 'taxOffice', 'taxNumber', 'purpose'] as const;
const hasGap = (rows: readonly Row[], cells: readonly string[]) => rows.some((r) => cells.some((cell) => r[cell] === null || r[cell] === undefined));

/** Der Wert einer Angabe von Ihnen, oder `null`. */
function answerValue(def: GemLine, answers: GemAnswers, field: keyof GemAnswers): GemValue | null {
  const raw = answers[field];
  if (raw === undefined) return null;
  if (def.kind === 'list') return { kind: 'list', rows: ((raw as { reason: string; amountCents: number }[]) ?? []).map((r) => ({ reason: r.reason, amountCents: r.amountCents })) };
  if (def.kind === 'elster') return { kind: 'elster' };
  if (typeof raw === 'boolean') return { kind: 'yesNo', value: raw };
  if (field === 'feeResolution') return raw === 'none' ? { kind: 'choice', value: 'none' } : { kind: 'date', value: (raw as { date: string }).date };
  if (def.kind === 'date') return { kind: 'date', value: String(raw) };
  if (def.kind === 'choice') return { kind: 'choice', value: String(raw) };
  return { kind: 'text', value: String(raw) };
}

export function computeTaxReturnGemReport(db: DbOrTx, params: ReportParams, env: ReportComputeEnv): TaxReturnGemReport {
  const period = taxPeriodInternal(db, params.taxPeriodId!)!;
  const years = period.fiscalYearIds.map((id) => reportYearInternal(db, id));
  const first = years[0]!;
  const last = years.at(-1)!;
  const formYear = assessmentYearOf(last.endsOn);
  const form = gemFormFor(formYear)!;
  const c: Context = { db, taxPeriodId: period.id, years, first, last, answers: period.answers, formYear, limitCents: form.line10LimitCents, timeZone: reportTimeZone(env) };
  const incomeReport: GemOrigin = { kind: 'report', report: 'taxReturnIncomeStatement', params: { taxPeriodId: period.id } };
  const reserveReport: GemOrigin = { kind: 'report', report: 'reserveStatement', params: { fiscalYearIds: period.fiscalYearIds } };

  const lastStatement = incomeStatement(db, { from: last.startsOn, to: last.endsOn });
  const sphere = (key: 'business' | 'purposeOperation') => lastStatement.spheres.find((s) => s.sphere === key);
  const reserves = reservesAtEnd(c).filter((r) => r.balanceCents !== 0);
  const given = endowmentsGiven(c);
  const received = endowmentsReceived(c);
  const answers = c.answers;

  const computed = (def: GemLine): { value: GemValue | null; missing?: boolean; origin?: GemOrigin } => {
    const source = def.source;
    if (typeof source === 'object') {
      const value = answerValue(def, answers, source.answer);
      const requiredWith = def.requiredWith ? typeof answers[def.requiredWith] === 'object' : false;
      const empty = value === null || (value.kind === 'list' && value.rows.length === 0);
      return { value, missing: (def.required === true || requiredWith) && empty, origin: { kind: 'answer', field: source.answer } };
    }
    switch (source) {
      case 'period':
        return { value: { kind: 'yearRange', from: first.designation, to: last.designation } };
      case 'revenue': {
        const labels = ['9', '9a', '9b'];
        const perYear = [...years].reverse().map((y, i) => {
          const revenue = annualRevenueForGemInternal(db, y.id);
          return { fiscalYearId: y.id, line: labels[i]!, cents: revenue.totalCents, parts: revenue.parts };
        });
        return { value: { kind: 'amountPerYear', perYear, parts: annualRevenueForGemInternal(db, last.id).parts }, origin: incomeReport };
      }
      case 'economicRevenue': {
        const cents = operationsRevenueInternal(db, last.id, ['business', 'purposeOperation']);
        return { value: { kind: 'yesNo', value: cents > c.limitCents, cents, limitCents: c.limitCents }, origin: incomeReport };
      }
      case 'businessList': {
        // Ein Eintrag „wGB zusammengefasst (§ 64 Abs. 2 AO)“, Bezeichnung aus allen Kategorien (Recherche 2026-10-25, Frage 1).
        const business = sphere('business');
        if (!business) return { value: { kind: 'list', rows: [] }, origin: { kind: 'lines', filterKey: 'business' } };
        const designation = business.categories.filter((k) => k.direction === 'income' && k.sumCents !== 0).map((k) => k.categoryId).sort().join(',');
        return { value: { kind: 'list', rows: [{ designation, incomeCents: business.incomeCents, expenseCents: business.expenseCents, resultCents: business.resultCents }] }, origin: { kind: 'lines', filterKey: 'business' } };
      }
      case 'purposeOperationList': {
        const rows = (sphere('purposeOperation')?.categories ?? []).filter((k) => k.direction === 'income' && k.sumCents !== 0).sort((a, b) => a.categoryId.localeCompare(b.categoryId)).map((k) => ({ designation: k.categoryId, incomeCents: k.sumCents }));
        return { value: { kind: 'list', rows }, origin: { kind: 'lines', filterKey: 'purposeOperation' } };
      }
      case 'purposeOperationSum':
        return { value: { kind: 'amount', cents: sphere('purposeOperation')?.incomeCents ?? 0 }, origin: { kind: 'lines', filterKey: 'purposeOperation' } };
      case 'reservesProjectFunds':
        return { value: { kind: 'list', rows: reserves.filter((r) => r.reserve.kind === 'projectFunds').map((r) => ({ reserveId: r.reserve.id, amountCents: r.balanceCents })) }, origin: reserveReport };
      case 'reservesReplacement': {
        const rows = reserves
          .filter((r) => r.reserve.kind === 'replacement')
          .map((r) => {
            const a = answers.replacementAssets?.[r.reserve.id];
            return { reserveId: r.reserve.id, asset: a?.asset ?? null, expectedCostCents: a?.expectedCostCents ?? null, regularDepreciationCents: a?.regularDepreciationCents ?? null, allocatedCents: r.allocatedCents, dissolvedCents: r.dissolvedCents, balanceCents: r.balanceCents };
          });
        return { value: { kind: 'list', rows }, missing: hasGap(rows, ['asset']), origin: reserveReport };
      }
      case 'reserveFree':
        return { value: { kind: 'amount', cents: reserves.filter((r) => r.reserve.kind === 'free').reduce((s, r) => s + r.balanceCents, 0) }, origin: reserveReport };
      case 'reservesParticipation': {
        const rows = reserves
          .filter((r) => r.reserve.kind === 'participation')
          .map((r) => {
            const a = answers.participations?.[r.reserve.id];
            return { reserveId: r.reserve.id, company: a?.company ?? null, taxOffice: a?.taxOffice ?? null, taxNumber: a?.taxNumber ?? null, amountCents: r.balanceCents };
          });
        return { value: { kind: 'list', rows }, missing: hasGap(rows, ['company', 'taxOffice', 'taxNumber']), origin: reserveReport };
      }
      case 'addsToAssets':
        return { value: { kind: 'amount', cents: linesWith(c, eq(financeAllocationLines.addsToAssets, true)).filter((l) => l.direction === 'income').reduce((s, l) => s + l.amountCents, 0) }, origin: { kind: 'lines', filterKey: 'addsToAssets' } };
      case 'endowmentsGivenAny':
        return { value: { kind: 'yesNo', value: given.length > 0 }, origin: { kind: 'partnerPayments' } };
      case 'endowmentsGiven':
        return { value: { kind: 'list', rows: given }, missing: hasGap(given, PARTY_CELLS), origin: { kind: 'partnerPayments' } };
      case 'endowmentsReceivedAny':
        return { value: { kind: 'yesNo', value: received.rows.length > 0 }, origin: { kind: 'lines', filterKey: 'endowmentsReceived' } };
      case 'endowmentsReceived':
        return { value: { kind: 'list', rows: received.rows }, missing: hasGap(received.rows, PARTY_CELLS), origin: { kind: 'lines', filterKey: 'endowmentsReceived' } };
      case 'noticePurposes': {
        // Der jüngste nicht stornierte Bescheid bis zum Ende des Zeitraums — der Bescheid zu dieser Erklärung kommt
        // später und lässt die abgegebene Fassung nicht veralten.
        const notice = db.select({ purposesText: financeNotices.purposesText }).from(financeNotices).where(and(isNull(financeNotices.voidedAt), lte(financeNotices.noticeDate, last.endsOn))).orderBy(desc(financeNotices.noticeDate), desc(financeNotices.createdAt)).get();
        return { value: notice ? { kind: 'text', value: notice.purposesText } : null, origin: { kind: 'notice' } };
      }
    }
  };

  const lines: GemLineValue[] = [];
  for (const def of form.lines) {
    if (def.showWhen) {
      const ref = lines.find((l) => l.line === def.showWhen!.line)?.value;
      if (!ref || ref.kind !== 'yesNo' || ref.value !== def.showWhen.equals) continue;
    }
    // Zeile 8 gibt es nur zu einem Beschluss mit Datum in Zeile 7.
    if (def.requiredWith && answers[def.requiredWith] === 'none') continue;
    const r = computed(def);
    lines.push({ line: def.line, value: r.value, missing: r.missing ?? false, ...(r.origin ? { origin: r.origin } : {}) });
  }

  return {
    taxPeriodId: period.id,
    years,
    formYear,
    line10LimitCents: form.line10LimitCents,
    lines,
    attachments: attachmentsOf(c, env, period.fiscalYearIds, reservesAtEnd(c).some((r) => r.movedInRange || r.balanceCents !== 0)),
    hints: hintsOf(c, form.assumed === true, lines, received.notToAssets),
    missingCount: lines.filter((l) => l.missing).length,
  };
}

function attachmentsOf(c: Context, env: ReportComputeEnv, yearIds: string[], withReserves: boolean): GemAttachment[] {
  const country = typeof env.settings[COUNTRY_KEY] === 'string' && env.settings[COUNTRY_KEY] ? (env.settings[COUNTRY_KEY] as string) : 'DE';
  const out: GemAttachment[] = [{ key: 'taxReturnIncomeStatement', params: { taxPeriodId: c.taxPeriodId } }];
  for (const y of c.years) out.push({ key: 'assetOverview', params: { fiscalYearId: y.id }, fiscalYearId: y.id });
  if (withReserves) out.push({ key: 'reserveStatement', params: { fiscalYearIds: yearIds } });
  for (const y of c.years) {
    const foreign = foreignActivityInternal(c.db, { from: y.startsOn, to: y.endsOn }, country, c.timeZone);
    // Beilage nur, wenn der Auslandsbericht Inhalt hat — nach Merkmal, nicht nach dem Sitz eines Kontakts (Designer Runde 8, 271).
    if (foreign.partnerPayments.length + foreign.otherAbroadLines.length > 0) out.push({ key: 'foreignActivity', params: { fiscalYearId: y.id }, fiscalYearId: y.id });
  }
  for (const y of c.years) {
    const trainer = c.db
      .select({ id: financeAllocationLines.id })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
      .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
      .where(and(eq(financeEntries.status, 'final'), eq(financeCategories.allowanceKind, 'trainer'), gte(financeEntries.entryDate, y.startsOn), lte(financeEntries.entryDate, y.endsOn)))
      .get();
    if (trainer) out.push({ key: 'peopleOverview', params: { fiscalYearId: y.id }, fiscalYearId: y.id });
  }
  for (const y of c.years) out.push({ key: 'assemblyMinutes', fiscalYearId: y.id });
  out.push({ key: 'activityReport' });
  if (c.answers.statuteSubmission === 'willSubmit') out.push({ key: 'statute' });
  return out;
}

const cents = (db: DbOrTx, key: Parameters<typeof valueAt>[1], date: string): number | null => {
  const v = valueAt(db, key, date);
  return v === null ? null : Number(v);
};

function hintsOf(c: Context, assumed: boolean, lines: readonly GemLineValue[], notToAssets: number): GemHint[] {
  const db = c.db;
  const hints: GemHint[] = [];
  // § 64 Abs. 3 S. 1 AO für jedes Jahr des Zeitraums (AEAO zu § 64 Nr. 18): darüber Anlagen GK, ZVE und GewSt.
  const businessYears: { designation: string; cents: number; limitCents: number }[] = [];
  for (const y of c.years) {
    const limit = cents(db, 'thresholdBusiness', y.endsOn);
    const value = operationsRevenueInternal(db, y.id, ['business']);
    if (limit !== null && value > limit) hints.push({ code: 'businessOverLimit', designation: y.designation, cents: value, limitCents: limit });
    if (limit !== null) businessYears.push({ designation: y.designation, cents: value, limitCents: limit });
  }
  if (!hints.some((h) => h.code === 'businessOverLimit')) hints.push({ code: 'kst1FullyExempt', years: businessYears });
  // E6a: die USt-Jahreserklärung gilt je Kalenderjahr — das, dessen 31.12. im Geschäftsjahr liegt (Rumpfjahr ohne 31.12.: keines).
  const vat = c.years
    .map((y) => Number(y.endsOn.slice(0, 4)) - (y.endsOn.slice(5) === '12-31' ? 0 : 1))
    .filter((year, i) => `${year}-12-31` >= c.years[i]!.startsOn && vatReturnRequiredInternal(db, year));
  for (const year of vat) hints.push({ code: 'vatReturnRequired', year, dueOn: vatReturnDueOnInternal(db, year) });
  if (vat.length === 0 && taxContextAt(db, c.last.endsOn)?.taxation === 'smallBusiness') hints.push({ code: 'noVatReturnSmallBusiness' });
  for (const y of c.years) {
    const limit = cents(db, 'thresholdTimelyUse', y.endsOn);
    const revenue = annualRevenueForGemInternal(db, y.id).totalCents;
    hints.push({ code: 'timelyUse', designation: y.designation, cents: revenue, limitCents: limit, required: limit === null || revenue > limit });
  }
  const gifts = db
    .select({ amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), inArray(financeCategories.key, GIFT_CATEGORY_KEYS), gte(financeEntries.entryDate, c.first.startsOn), lte(financeEntries.entryDate, c.last.endsOn)))
    .all();
  if (gifts.length > 0) hints.push({ code: 'gratuitousCandidates', count: gifts.length, cents: gifts.reduce((s, g) => s - g.amountCents, 0) });
  const business = lines.find((l) => l.line === '11')?.value;
  if (business?.kind === 'list' && business.rows.length > 0) hints.push({ code: 'businessCombined' });
  // § 64 Abs. 3 S. 2 AO ab 2026: Zeile 10 = nein und insgesamt ein Gewinn der Betriebe (Ergebnis > 0, C1 2b, Plan E6a
  // Task 8) → Zweckbetriebe ertragsteuerlich nicht mehr geprüft.
  const line10 = lines.find((l) => l.line === '10')?.value;
  if (c.formYear >= 2026 && line10?.kind === 'yesNo' && !line10.value && operationsResultInternal(db, { from: c.last.startsOn, to: c.last.endsOn }) > 0) hints.push({ code: 'spheresMergeable' });
  if (notToAssets > 0) hints.push({ code: 'endowmentNotToAssets', count: notToAssets });
  hints.push({ code: 'revenueDefinition' }, { code: 'unverifiedLines' });
  if (assumed) hints.push({ code: 'formAssumed', formYear: c.formYear });
  return hints;
}

/** Je Herkunft die Filter für `finance_lines_list` (keine ID-Listen, Finanz-Spec § 9.1). */
function linesFilterOf(data: TaxReturnGemReport): Record<string, ReportLinesFilter> {
  const first = data.years[0]!;
  const last = data.years.at(-1)!;
  return {
    business: { fiscalYearId: last.id, sphere: 'business' },
    purposeOperation: { fiscalYearId: last.id, sphere: 'purposeOperation', direction: 'income' },
    addsToAssets: { from: first.startsOn, to: last.endsOn, direction: 'income', addsToAssets: true },
    endowmentsReceived: { from: first.startsOn, to: last.endsOn, direction: 'income', assetEndowment: true },
  };
}

const periodLabel = (data: { years: ReportYear[] }) => {
  const first = data.years[0]?.designation ?? '';
  const last = data.years.at(-1)?.designation ?? '';
  return first === last ? first : `${first}–${last}`;
};

export const taxReturnGemReport: ReportDefinition<TaxReturnGemReport> = {
  key: 'taxReturnGem',
  group: 'taxOffice',
  personal: true,
  available: true,
  orientation: 'landscape',
  paramsSchema: taxPeriodParamsSchema,
  checkParams: checkTaxPeriodParams,
  years: yearsOfTaxPeriod,
  paramsForYear: taxPeriodParamsForYear,
  settingKeys: [COUNTRY_KEY, TIME_ZONE_SETTING],
  compute: computeTaxReturnGemReport,
  toTypst: taxReturnGemTypst,
  titleKey: 'finance.reports.taxReturnGem.title',
  paperTitle: 'Werte für die Anlage Gem',
  paperPeriod: (data) => `Erklärungszeitraum ${periodLabel(data)}`,
  finalizeBlock: (data) => (data.missingCount > 0 ? { code: 'reportGemIncomplete', params: { missing: data.missingCount } } : null),
  linesFilter: linesFilterOf,
};
