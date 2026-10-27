import { createHash } from 'node:crypto';
import type { DbOrTx } from '@kompass/core';
import { and, asc, eq, gte, lte, ne, or } from 'drizzle-orm';
import { financeAllocationLines, financeCategories, financeDatedValues, financeEntries, financeFiscalYears } from '../schema';
import { REVERSE_CHARGE_CODES } from './codes';
import { DATED_SERIES } from './dated-series';
import { valueAt } from './dated-values';
import { taxContextAt, taxOf, type TaxCode } from './tax';
import { declarationDueOn, taxPeriodOfYearInternal } from './tax-periods';
import { parseVatPeriod, vatPeriodOf, vatTaxPointOn, type VatPeriodKind, type VatPeriodRange } from './vat-calendar';
import { vatProfileAt } from './vat-settings';
import { nextWorkingDay, type FederalState } from './working-days';

/**
 * Umsatzsteuer-Zeiträume (Spec E6 Teil 4, Plan E6a Task 4). In `ledger/`, weil Fristen (`closing/`), Schritt 12, die
 * Anlage-Gem-Hinweise (`reporting/`) und der Bericht der Voranmeldung (E6b) es lesen. Alles berechnet, nie gespeichert
 * (Prinzip 5) — gespeichert wird nur die Abgabe (`vat-filings.ts`).
 */

type ReverseChargeCode = (typeof REVERSE_CHARGE_CODES)[number];
const isReverseCharge = (code: string): code is ReverseChargeCode => (REVERSE_CHARGE_CODES as readonly string[]).includes(code);

export { parseVatPeriod, vatPeriodOf, vatTaxPointOn, type VatPeriodKind, type VatPeriodRange } from './vat-calendar';

// ── Zeiträume ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

function periodsOfYear(year: number, kind: VatPeriodKind): VatPeriodRange[] {
  return kind === 'month' ? Array.from({ length: 12 }, (_, i) => vatPeriodOf(`${year}-${pad(i + 1)}-01`, 'month')) : [1, 4, 7, 10].map((m) => vatPeriodOf(`${year}-${pad(m)}-01`, 'quarter'));
}

/**
 * Fällig am 10. Tag nach Ablauf des Zeitraums (§ 18 Abs. 1 S. 1 UStG), mit Dauerfristverlängerung einen Monat später
 * (§ 46 UStDV), jeweils am nächsten Werktag (§ 108 Abs. 3 AO).
 */
export function vatAdvanceDueOn(periodEndsOn: string, permanentExtension: boolean, state: FederalState | null): string {
  const year = Number(periodEndsOn.slice(0, 4));
  const total = year * 12 + Number(periodEndsOn.slice(5, 7)) + (permanentExtension ? 1 : 0);
  return nextWorkingDay(`${Math.floor(total / 12)}-${pad((total % 12) + 1)}-10`, state);
}

// ── Zeilen ─────────────────────────────────────────────────────────────────

export interface VatPeriodLine { lineId: string; entryId: string; taxCode: TaxCode; rateKind: 'standard' | 'reduced'; amountCents: number; entryDate: string; serviceDate: string | null; taxPointOn: string; categoryId: string }

/**
 * Ohne Rechteprüfung: festgeschriebene Zeilen mit Kennzeichen (≠ `none`), deren Steuer im Rahmen entsteht — § 13b und
 * Erwerb nach `vatTaxPointOn`, die übrigen nach dem Buchungstag. Der Entstehungstag liegt nie nach dem Buchungstag,
 * darum genügt `entryDate ≥ from` und `entryDate ≤ to` oder `serviceDate ≤ to` als Vorauswahl.
 */
export function vatPeriodLinesInternal(db: DbOrTx, range: { from: string; to: string }): VatPeriodLine[] {
  return db
    .select({ lineId: financeAllocationLines.id, entryId: financeAllocationLines.entryId, taxCode: financeAllocationLines.taxCode, rateKind: financeAllocationLines.rateKind, amountCents: financeAllocationLines.amountCents, entryDate: financeEntries.entryDate, serviceDate: financeAllocationLines.serviceDate, categoryId: financeAllocationLines.categoryId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .where(and(eq(financeEntries.status, 'final'), ne(financeAllocationLines.taxCode, 'none'), gte(financeEntries.entryDate, range.from), or(lte(financeEntries.entryDate, range.to), lte(financeAllocationLines.serviceDate, range.to))))
    .orderBy(asc(financeAllocationLines.id))
    .all()
    .map((l) => ({ ...l, taxCode: l.taxCode as TaxCode, rateKind: l.rateKind as 'standard' | 'reduced', taxPointOn: vatTaxPointOn({ taxCode: l.taxCode as TaxCode, entryDate: l.entryDate, serviceDate: l.serviceDate }) }))
    .filter((l) => l.taxPointOn >= range.from && l.taxPointOn <= range.to);
}

/** Je § 13b-/Erwerbskennzeichen: Bemessungsgrundlage (Ausgabe positiv) und Steuer — gerechnet auf die Summe je Satz, nicht je Zeile. */
export type VatPeriodAmounts = Record<ReverseChargeCode, { baseCents: number; taxCents: number }>;

/** Ohne Rechteprüfung: Basis und Steuer je Kennzeichen über die Zeilen eines Zeitraums (Quartal, Monat oder Jahr). */
export function reverseChargeAmountsInternal(db: DbOrTx, lines: readonly VatPeriodLine[]): VatPeriodAmounts {
  const amounts = Object.fromEntries(REVERSE_CHARGE_CODES.map((c) => [c, { baseCents: 0, taxCents: 0 }])) as VatPeriodAmounts;
  const byRate = new Map<string, { code: ReverseChargeCode; rate: number; baseCents: number }>();
  for (const line of lines) {
    if (!isReverseCharge(line.taxCode)) continue;
    const rate = taxContextAt(db, line.taxPointOn)?.rates[line.rateKind] ?? 0;
    const key = `${line.taxCode}|${rate}`;
    const group = byRate.get(key) ?? { code: line.taxCode, rate, baseCents: 0 };
    group.baseCents += -line.amountCents;
    byRate.set(key, group);
  }
  for (const group of byRate.values()) {
    amounts[group.code].baseCents += group.baseCents;
    amounts[group.code].taxCents += Math.round((group.baseCents * group.rate) / 100);
  }
  return amounts;
}

const reverseChargeBase = (amounts: VatPeriodAmounts) => REVERSE_CHARGE_CODES.some((c) => amounts[c].baseCents !== 0);

// ── Zeitraumart, Pflicht, Frist ────────────────────────────────────────────

/**
 * § 18 Abs. 2 S. 2 UStG: Beträgt die Steuer des Vorjahres mehr als 9.000 €, ist der Kalendermonat der Zeitraum. Die
 * Steuer ist hier die geschuldete (eigene Umsätze und § 13b) abzüglich der abziehbaren Vorsteuer.
 */
const MONTHLY_ABOVE_CENTS = 900_000;

function taxOfYearInternal(db: DbOrTx, calendarYear: number): number {
  const lines = vatPeriodLinesInternal(db, { from: `${calendarYear}-01-01`, to: `${calendarYear}-12-31` });
  const deductible = new Map(db.select({ id: financeCategories.id, inputTaxDeductible: financeCategories.inputTaxDeductible }).from(financeCategories).all().map((c) => [c.id, c.inputTaxDeductible] as const));
  let total = 0;
  for (const line of lines) {
    const context = taxContextAt(db, line.entryDate);
    if (!context) continue;
    const tax = taxOf({ amountCents: line.amountCents, taxCode: line.taxCode, rateKind: line.rateKind, taxation: context.taxation, inputTaxDeductible: deductible.get(line.categoryId) ?? 'no', rates: context.rates });
    total += tax.outputTaxCents + tax.reverseChargeTaxCents - tax.inputTaxCents;
  }
  return total;
}

/** Ohne Rechteprüfung: Quartal oder Monat im Kalenderjahr — die Einstellung am 01.01., bei „automatisch“ nach der Vorjahressteuer. */
export function vatAdvancePeriodKindInternal(db: DbOrTx, calendarYear: number): VatPeriodKind {
  const setting = vatProfileAt(db, `${calendarYear}-01-01`).advancePeriod;
  if (setting !== 'auto') return setting;
  return taxOfYearInternal(db, calendarYear - 1) > MONTHLY_ABOVE_CENTS ? 'month' : 'quarter';
}

/** Der Beginn des ersten Geschäftsjahres in Kompass, oder `null`. */
function firstFiscalStartInternal(db: DbOrTx): string | null {
  return db.select({ startsOn: financeFiscalYears.startsOn }).from(financeFiscalYears).orderBy(asc(financeFiscalYears.startsOn)).get()?.startsOn ?? null;
}

export interface VatPeriodState extends VatPeriodRange { required: boolean; reason: 'regular' | 'section18_4a' | null; dueOn: string | null; amounts: VatPeriodAmounts }

/**
 * Ohne Rechteprüfung: die begonnenen Voranmeldungszeiträume eines Kalenderjahres ab dem ersten Geschäftsjahr. Pflicht:
 * Regelbesteuerung am Zeitraumende ohne Befreiung am Zeitraumbeginn (`regular`); sonst eine § 13b-/Erwerbszeile im
 * Zeitraum (§ 18 Abs. 4a UStG, `section18_4a`) — unabhängig von „Unternehmer“: auch die juristische Person ohne
 * Unternehmereigenschaft meldet. Regelbesteuerung mit Befreiung: keine Voranmeldung.
 */
export function vatAdvancePeriodsInternal(db: DbOrTx, calendarYear: number, today: string): VatPeriodState[] {
  const first = firstFiscalStartInternal(db);
  if (!first) return [];
  const kind = vatAdvancePeriodKindInternal(db, calendarYear);
  return periodsOfYear(calendarYear, kind)
    .filter((p) => p.startsOn <= today && p.endsOn >= first)
    .map((p) => {
      const amounts = reverseChargeAmountsInternal(db, vatPeriodLinesInternal(db, { from: p.startsOn, to: p.endsOn }));
      const atEnd = vatProfileAt(db, p.endsOn);
      const regular = atEnd.taxation === 'regular';
      const exempt = regular && vatProfileAt(db, p.startsOn).advanceExempt;
      const reason = regular ? (exempt ? null : 'regular') : reverseChargeBase(amounts) ? 'section18_4a' : null;
      return { ...p, required: reason !== null, reason, dueOn: reason ? vatAdvanceDueOn(p.endsOn, atEnd.permanentExtension, atEnd.taxOfficeState) : null, amounts };
    });
}

/** Regelbesteuerung an irgendeinem Tag des Jahres (Reihe `taxation` mit Überschreibungen). */
function regularInYear(db: DbOrTx, calendarYear: number): boolean {
  const from = `${calendarYear}-01-01`;
  const to = `${calendarYear}-12-31`;
  const changes = [...DATED_SERIES.taxation.series.map((e) => e.validFrom), ...db.select({ validFrom: financeDatedValues.validFrom }).from(financeDatedValues).where(eq(financeDatedValues.key, 'taxation')).all().map((r) => r.validFrom)];
  return [from, ...changes.filter((d) => d > from && d <= to)].some((d) => valueAt(db, 'taxation', d) === 'regular');
}

/**
 * Ohne Rechteprüfung: Umsatzsteuer-Jahreserklärung je **Kalenderjahr** (§ 18 Abs. 3 UStG; § 16 Abs. 1 S. 2 UStG) —
 * bei Regelbesteuerung an einem Tag des Jahres, sonst bei einer § 13b-/Erwerbszeile mit Entstehung im Jahr
 * (§ 18 Abs. 4a UStG).
 */
export function vatReturnRequiredInternal(db: DbOrTx, calendarYear: number): boolean {
  if (regularInYear(db, calendarYear)) return true;
  return reverseChargeBase(reverseChargeAmountsInternal(db, vatPeriodLinesInternal(db, { from: `${calendarYear}-01-01`, to: `${calendarYear}-12-31` })));
}

/**
 * Ohne Rechteprüfung: Menüeintrag „Umsatzsteuer“ — für Unternehmer immer, sonst sobald im laufenden Kalenderjahr oder im
 * Vorjahr eine Voranmeldung anfällt (eine § 13b-/Erwerbszeile): Auch die juristische Person ohne Unternehmereigenschaft
 * meldet nach § 18 Abs. 4a UStG (Befund 37), und im Januar steht die Voranmeldung des vierten Quartals noch aus.
 */
export function vatMenuShownInternal(db: DbOrTx, today: string): boolean {
  if (vatProfileAt(db, today).entrepreneur) return true;
  const year = Number(today.slice(0, 4));
  return vatReturnRequiredInternal(db, year) || vatReturnRequiredInternal(db, year - 1);
}

/**
 * Ohne Rechteprüfung: die Frist der Jahreserklärung — `declarationDueOn` mit der Beratung des Erklärungszeitraums des
 * Geschäftsjahres, das den 31.12. enthält (ohne Zeitraum: ohne Beratung), und dem Bundesland am 31.12.
 */
export function vatReturnDueOnInternal(db: DbOrTx, calendarYear: number): string {
  const yearEnd = `${calendarYear}-12-31`;
  const fiscalYear = db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(and(lte(financeFiscalYears.startsOn, yearEnd), gte(financeFiscalYears.endsOn, yearEnd))).get();
  const withTaxAdvisor = fiscalYear ? (taxPeriodOfYearInternal(db, fiscalYear.id)?.withTaxAdvisor ?? false) : false;
  return declarationDueOn(calendarYear, withTaxAdvisor, vatProfileAt(db, yearEnd).taxOfficeState);
}

/**
 * Ohne Rechteprüfung: die Teile der Zeilen eines Zeitraums (`'YYYY-Qn'`, `'YYYY-MM'`, `'YYYY'`), sortiert —
 * `lineId|amountCents|taxCode|rateKind|taxPointOn`, bei Regelbesteuerung am Zeitraumende alle mit Kennzeichen, sonst nur
 * § 13b und Erwerb. Quelle des Fingerabdrucks und des Abbilds an der Abgabe (Plan E6a Task 11a), damit beide dasselbe
 * vergleichen.
 */
export function vatPeriodPartsInternal(db: DbOrTx, periodKey: string, override?: VatPartOverride): string[] {
  const range = parseVatPeriod(periodKey);
  if (!range) throw new Error(`Kein Umsatzsteuer-Zeitraum: ${periodKey}`);
  const regular = vatProfileAt(db, range.endsOn).taxation === 'regular';
  const lines: Pick<VatPeriodLine, 'lineId' | 'amountCents' | 'taxCode' | 'rateKind' | 'taxPointOn'>[] = vatPeriodLinesInternal(db, { from: range.startsOn, to: range.endsOn }).filter((l) => l.lineId !== override?.lineId);
  if (override && override.taxCode !== 'none' && override.entryDate >= range.startsOn && override.taxPointOn >= range.startsOn && override.taxPointOn <= range.endsOn) lines.push(override);
  return lines
    .filter((l) => regular || isReverseCharge(l.taxCode))
    .map((l) => `${l.lineId}|${l.amountCents}|${l.taxCode}|${l.rateKind}|${l.taxPointOn}`)
    .sort();
}

/**
 * N8: eine festgeschriebene Zeile, wie sie nach einer beantragten Korrektur stünde — ersetzt in
 * `vatPeriodPartsInternal` die Zeile gleicher ID (Kennzeichen `none` oder Entstehungstag außerhalb: fällt weg).
 */
export interface VatPartOverride { lineId: string; amountCents: number; taxCode: TaxCode; rateKind: 'standard' | 'reduced'; entryDate: string; taxPointOn: string }

/** Fingerabdruck aus `vatPeriodPartsInternal`. */
export const vatDigestOfParts = (parts: readonly string[]): string => createHash('sha256').update(parts.join('\n')).digest('hex');

/**
 * Ohne Rechteprüfung: Fingerabdruck der Zeilen eines Zeitraums. Ändert sich eine Zeile, ein Kennzeichen oder ein
 * Entstehungstag im Zeitraum, ändert er sich; eine Buchung in einem anderen Zeitraum nicht.
 */
export function vatPeriodDigestInternal(db: DbOrTx, periodKey: string): string {
  return vatDigestOfParts(vatPeriodPartsInternal(db, periodKey));
}
