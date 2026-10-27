import { paperDate, type DbOrTx } from '@kompass/core';
import { and, asc, eq, gte, lte, ne } from 'drizzle-orm';
import { REVERSE_CHARGE_CODES as REVERSE_CHARGE } from '../../ledger/codes';
import { DATED_SERIES } from '../../ledger/dated-series';
import { valueAt } from '../../ledger/dated-values';
import { taxContextAt, taxOf, type TaxCode, type Taxation } from '../../ledger/tax';
import { financeAllocationLines, financeCategories, financeDatedValues, financeEntries } from '../../schema';
import { dayBefore } from '../other-assets';
import type { ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { parseVatPeriod, vatAdvancePeriodKindInternal, type VatPeriodKind } from '../../ledger/vat-periods';
import { euroBase, VAT_FIGURE_GROUP_TITLES, vatFormFor, type VatFigureSource } from '../vat-forms';
import { vatFigureText, vatFiguresFor, vatPeriodShortLabel, vatFigureValuesInternal, type VatFigureValue } from './vat-advance-return';

/** Die Schlüssel der Voranmeldungszeiträume eines Jahres. */
function periodsOfYearKeys(year: number, kind: VatPeriodKind): string[] {
  return kind === 'month' ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`) : [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
}
import { amountCell, emptyCell, checkYearOrDate, heading, paragraph, reportYearInternal, spanRow, strongAmountCell, strongCell, table, textCell, yearParamsSchema } from './common';

/**
 * Umsatzsteuer-Summen (Finanz-Spec § 9.2, Rechenschaft B1 Task 9; seit E6b je Kalenderjahr — dem, in dem das
 * Geschäftsjahr endet — mit den Kennzahlen der Jahreserklärung und ihrer Herkunft aus den Voranmeldungen; die Sicht je
 * Kennzeichen bleibt als Anhang): je Steuerkennzeichen Netto, geschuldete Steuer
 * (eigene Umsätze, § 13b und innergemeinschaftlicher Erwerb), abziehbare und nicht abziehbare Vorsteuer, über die
 * festgeschriebenen Zeilen des Jahres. Jede Zeile rechnet mit Besteuerungsform und Sätzen ihres Buchungstags; fehlen
 * sie, zählt die Zeile nicht und der Bericht warnt (`taxContextMissing`). § 13b unter Kleinunternehmerschaft verlangt
 * eine Jahreserklärung (§ 18 Abs. 4a UStG) — Warnung `section18_4a`. Vorzeichen nach der Richtung der Kategorie:
 * Zurückgenommenes mindert, statt als Gegenrichtung zu zählen.
 */

export interface VatSummaryCode {
  taxCode: string;
  rateKind: 'standard' | 'reduced';
  lineCount: number;
  netCents: number;
  outputTaxCents: number;
  reverseChargeTaxCents: number;
  inputTaxCents: number;
  /** Vorsteuer, die die Zeile unter Regelbesteuerung und voll abziehbarer Kategorie hätte, minus der abziehbaren. */
  notDeductibleCents: number;
}

export interface VatSummaryReport {
  /** E6b: das Kalenderjahr, in dem das Geschäftsjahr endet — die Jahreserklärung gilt je Kalenderjahr (§ 18 Abs. 3 UStG). */
  calendarYear: number;
  /** Die Fassung der Jahreserklärung (`vat-forms.ts`), `null` vor 2025. */
  formYear: number | null;
  /** Die Fassung des Jahres ist angenommen (Muster noch nicht geprüft). */
  assumed: boolean;
  /** Werte je Quelle über das Kalenderjahr (`vatFigureValuesInternal`). */
  values: VatFigureValue[];
  /** Je Voranmeldungszeitraum des Jahres mit Wert: die Quellen ≠ 0 — die Herkunft der Jahreswerte. */
  byPeriod: { period: string; values: Partial<Record<VatFigureSource, number>> }[];
  taxation: { from: string; to: string; taxation: Taxation }[];
  /** Unternehmer an mindestens einem Tag des Jahres (Reihe `vatEntrepreneur`, Regelbesteuerung eingeschlossen). */
  entrepreneur: boolean;
  byCode: VatSummaryCode[];
  /** `balanceCents` = geschuldet (eigene Umsätze und § 13b) − abziehbare Vorsteuer. */
  totals: { outputTaxCents: number; reverseChargeTaxCents: number; inputTaxCents: number; notDeductibleCents: number; balanceCents: number };
  warnings: ('section18_4a' | 'taxContextMissing')[];
}

const CODE_ORDER = ['standard', 'reduced', 'rc13bEu', 'rc13bOther', 'icAcquisition', 'exemptCounted', 'exemptNotCounted'];

/** Die Abschnitte gleicher Besteuerungsform im Jahr (Reihe `taxation` mit Überschreibungen). */
function taxationPeriods(db: DbOrTx, year: { startsOn: string; endsOn: string }): VatSummaryReport['taxation'] {
  const changes = [...DATED_SERIES.taxation.series.map((e) => e.validFrom), ...db.select({ validFrom: financeDatedValues.validFrom }).from(financeDatedValues).where(eq(financeDatedValues.key, 'taxation')).all().map((r) => r.validFrom)];
  const starts = [...new Set([year.startsOn, ...changes.filter((d) => d > year.startsOn && d <= year.endsOn)])].sort();
  const periods: VatSummaryReport['taxation'] = [];
  starts.forEach((from, i) => {
    const to = i + 1 < starts.length ? dayBefore(starts[i + 1]!) : year.endsOn;
    const taxation = valueAt(db, 'taxation', from) as Taxation | null;
    if (taxation === null) return;
    const last = periods.at(-1);
    if (last && last.taxation === taxation && last.to === dayBefore(from)) last.to = to;
    else periods.push({ from, to, taxation });
  });
  return periods;
}

/** Unternehmer an einem Tag des Jahres: am ersten Tag oder ab einem Stand darin. Regelbesteuerung macht ihn dazu. */
function entrepreneurInYear(db: DbOrTx, year: { startsOn: string; endsOn: string }, taxation: VatSummaryReport['taxation']): boolean {
  if (taxation.some((t) => t.taxation === 'regular')) return true;
  const changes = db.select({ validFrom: financeDatedValues.validFrom }).from(financeDatedValues).where(eq(financeDatedValues.key, 'vatEntrepreneur')).all().map((r) => r.validFrom);
  const days = [year.startsOn, ...changes.filter((d) => d > year.startsOn && d <= year.endsOn)];
  return days.some((d) => valueAt(db, 'vatEntrepreneur', d) === true);
}

export function computeVatSummaryReport(db: DbOrTx, params: ReportParams): VatSummaryReport {
  const calendarYear = Number(reportYearInternal(db, params.fiscalYearId!).endsOn.slice(0, 4));
  const year = { startsOn: `${calendarYear}-01-01`, endsOn: `${calendarYear}-12-31` };
  const lines = db
    .select({ amountCents: financeAllocationLines.amountCents, taxCode: financeAllocationLines.taxCode, rateKind: financeAllocationLines.rateKind, entryDate: financeEntries.entryDate, direction: financeCategories.direction, inputTaxDeductible: financeCategories.inputTaxDeductible })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn), ne(financeAllocationLines.taxCode, 'none')))
    .orderBy(asc(financeEntries.entryDate))
    .all();

  const codes = new Map<string, VatSummaryCode>();
  const warnings = new Set<VatSummaryReport['warnings'][number]>();
  const contexts = new Map<string, ReturnType<typeof taxContextAt>>();
  for (const line of lines) {
    if (!contexts.has(line.entryDate)) contexts.set(line.entryDate, taxContextAt(db, line.entryDate));
    const context = contexts.get(line.entryDate)!;
    if (!context) {
      warnings.add('taxContextMissing');
      continue;
    }
    const taxCode = line.taxCode as TaxCode;
    const rateKind: 'standard' | 'reduced' = taxCode === 'standard' || taxCode === 'reduced' ? taxCode : (line.rateKind ?? 'standard');
    // Einnahmen rechnen als Einnahme, Ausgaben als Ausgabe; das Vorzeichen der Zeile mindert nur (Rücknahme, Erstattung).
    const gross = Math.abs(line.amountCents);
    const asIncome = line.direction === 'income' || (line.direction !== 'expense' && line.amountCents > 0);
    const normalized = asIncome ? gross : -gross;
    const factor = line.amountCents === 0 ? 0 : Math.sign(line.amountCents) === Math.sign(normalized) ? 1 : -1;
    const input = { amountCents: normalized, taxCode, rateKind, rates: context.rates };
    const actual = taxOf({ ...input, taxation: context.taxation, inputTaxDeductible: line.inputTaxDeductible });
    const full = taxOf({ ...input, taxation: 'regular', inputTaxDeductible: 'yes' });
    if (actual.reverseChargeTaxCents > 0 && context.taxation === 'smallBusiness') warnings.add('section18_4a');
    const key = `${taxCode}|${rateKind}`;
    const row = codes.get(key) ?? { taxCode, rateKind, lineCount: 0, netCents: 0, outputTaxCents: 0, reverseChargeTaxCents: 0, inputTaxCents: 0, notDeductibleCents: 0 };
    row.lineCount += 1;
    // Netto nach der Richtung der Kategorie wie die Steuer daneben (Befund 30 h): Eine § 13b-Ausgabe von 200 € steht als
    // 200,00 neben 38,00 wie Kz 846/847 darüber, nicht als −200,00; Zurückgenommenes mindert.
    row.netCents += factor * Math.abs(actual.netCents);
    row.outputTaxCents += factor * actual.outputTaxCents;
    row.reverseChargeTaxCents += factor * actual.reverseChargeTaxCents;
    row.inputTaxCents += factor * actual.inputTaxCents;
    row.notDeductibleCents += factor * (full.inputTaxCents - actual.inputTaxCents);
    codes.set(key, row);
  }

  const byCode = [...codes.values()].sort((a, b) => CODE_ORDER.indexOf(a.taxCode) - CODE_ORDER.indexOf(b.taxCode) || a.rateKind.localeCompare(b.rateKind));
  const sum = (pick: (c: VatSummaryCode) => number) => byCode.reduce((s, c) => s + pick(c), 0);
  const outputTaxCents = sum((c) => c.outputTaxCents);
  const reverseChargeTaxCents = sum((c) => c.reverseChargeTaxCents);
  const inputTaxCents = sum((c) => c.inputTaxCents);
  const form = vatFormFor('annual', calendarYear);
  const kind = vatAdvancePeriodKindInternal(db, calendarYear);
  const byPeriod = periodsOfYearKeys(calendarYear, kind).flatMap((key) => {
    const range = parseVatPeriod(key)!;
    const values = Object.fromEntries(vatFigureValuesInternal(db, { from: range.startsOn, to: range.endsOn }).filter((v) => v.cents !== 0).map((v) => [v.source, v.cents]));
    return Object.keys(values).length > 0 ? [{ period: key, values }] : [];
  });
  const taxation = taxationPeriods(db, year);
  return {
    calendarYear,
    formYear: form?.validFromYear ?? null,
    assumed: form?.assumed === true,
    values: vatFigureValuesInternal(db, { from: year.startsOn, to: year.endsOn }),
    byPeriod,
    taxation,
    entrepreneur: entrepreneurInYear(db, year, taxation),
    byCode,
    totals: { outputTaxCents, reverseChargeTaxCents, inputTaxCents, notDeductibleCents: sum((c) => c.notDeductibleCents), balanceCents: outputTaxCents + reverseChargeTaxCents - inputTaxCents },
    warnings: (['section18_4a', 'taxContextMissing'] as const).filter((w) => warnings.has(w)),
  };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const REVERSE_CHARGE_CODES: readonly string[] = REVERSE_CHARGE;
const CODE_TEXT: Record<string, string> = {
  standard: 'Regelsatz',
  reduced: 'ermäßigter Satz',
  // Die Wörter der Buchungsmaske (Designer Runde 8, 275/276).
  rc13bEu: '§ 13b, Leistung aus der EU',
  rc13bOther: '§ 13b, übrige',
  icAcquisition: 'innergemeinschaftlicher Erwerb',
  exemptCounted: 'steuerfrei, zählt zum Umsatz',
  exemptNotCounted: 'steuerfrei, zählt nicht zum Umsatz',
};
const TAXATION_TEXT: Record<Taxation, string> = { smallBusiness: 'Kleinunternehmer (§ 19 UStG)', regular: 'Regelbesteuerung' };
const RATE_TEXT = { standard: 'Regelsatz', reduced: 'ermäßigt' } as const;

const codeText = (c: VatSummaryCode) => (REVERSE_CHARGE_CODES.includes(c.taxCode) ? `${CODE_TEXT[c.taxCode]} (${RATE_TEXT[c.rateKind]})` : (CODE_TEXT[c.taxCode] ?? c.taxCode));

/**
 * Kleinunternehmer das ganze Jahr: nur der Satz, dazu die Steuer nach § 13b, falls es sie gibt — die übrigen
 * Kennzeichen tragen keine Steuer (Designer Runde 6, 267).
 */
const SMALL_BUSINESS_TEXT = 'Kleinunternehmer nach § 19 UStG: keine Umsatzsteuer auf eigene Umsätze.';
/**
 * Kein Unternehmer im ganzen Jahr (Test-Abnahme 2026-10-27): § 19 UStG gilt nur für Unternehmer — ein Verein ohne
 * Leistungen gegen Entgelt ist keiner (§ 2 Abs. 1 UStG) und darf nicht „Kleinunternehmer“ heißen.
 */
const NOT_ENTREPRENEUR_TEXT = 'Kein Unternehmer im Sinne des UStG: keine Umsatzsteuer auf eigene Umsätze.';
const smallBusinessText = (data: VatSummaryReport) => (data.entrepreneur ? SMALL_BUSINESS_TEXT : NOT_ENTREPRENEUR_TEXT);

/**
 * Ohne Inhalt (Designer Runde 7, 16a D): Kleinunternehmer das ganze Jahr, ohne Steuer nach § 13b und ohne Hinweis —
 * dann steht nur der eine Satz auf dem Papier.
 */
function vatEmpty(data: VatSummaryReport): string | null {
  const smallOnly = data.taxation.length > 0 && data.taxation.every((t) => t.taxation === 'smallBusiness');
  return smallOnly && data.warnings.length === 0 && !data.byCode.some((c) => REVERSE_CHARGE_CODES.includes(c.taxCode)) ? smallBusinessText(data) : null;
}

function smallBusinessTypst(data: VatSummaryReport): string {
  const parts = [paragraph(smallBusinessText(data))];
  const reverse = data.byCode.filter((c) => REVERSE_CHARGE_CODES.includes(c.taxCode));
  if (reverse.length > 0) {
    parts.push(heading(2, 'Steuer nach § 13b UStG'));
    parts.push(
      table('(1fr, 14mm, 28mm, 28mm)', ['in €', 'Zeilen', 'Netto', 'Steuer'], [...reverse.map((c) => [textCell(codeText(c)), amountLikeCell(c.lineCount), amountCell(c.netCents), amountCell(c.reverseChargeTaxCents)]), [strongCell('Summe'), emptyCell, emptyCell, strongAmountCell(data.totals.reverseChargeTaxCents)]], { rightHeads: [1, 2, 3] }),
    );
  }
  return parts.join('\n\n');
}

/** Eine Anzahl rechtsbündig wie die Beträge daneben. */
const amountLikeCell = (n: number) => `table.cell(align: right)[${n}]`;

/** Die Kennzahlen der Jahreserklärung mit Wert, die Herkunft als Voranmeldungen des Jahres (Board Umsatzsteuer 9). */
function figuresTypst(data: VatSummaryReport): string[] {
  const form = data.formYear === null ? null : vatFormFor('annual', data.formYear);
  if (!form) return [];
  const taxation = data.taxation.at(-1)?.taxation ?? 'smallBusiness';
  const byCents = new Map(data.values.map((v) => [v.source, v.cents]));
  const shown = vatFiguresFor(form, taxation)
    .map((figure) => ({ figure, cents: byCents.get(figure.source) ?? 0 }))
    .filter(({ figure, cents }) => (figure.unit === 'euro' ? euroBase(cents) !== 0 : cents !== 0));
  const parts = [heading(2, `Kennzahlen der Umsatzsteuer-Jahreserklärung ${data.calendarYear}`)];
  if (data.assumed) parts.push(paragraph(form.notes.at(-1) ?? ''));
  if (shown.length === 0) return [...parts, paragraph('Im Kalenderjahr gibt es keine Werte für die Jahreserklärung.')];
  const rows: string[][] = [];
  let group: string | null = null;
  for (const { figure, cents } of shown) {
    if (figure.group !== group) {
      group = figure.group;
      rows.push([spanRow(4, VAT_FIGURE_GROUP_TITLES[figure.group])]);
    }
    // „Q2 2026“ wie auf der Seite der Voranmeldung, nicht „2. Quartal 2026“ — es bricht sonst um (275/276).
    const origin = data.byPeriod.filter((p) => (p.values[figure.source] ?? 0) !== 0).map((p) => vatPeriodShortLabel(p.period));
    rows.push([textCell(figure.code), textCell(figure.label), `table.cell(align: right)[${vatFigureText(figure, cents)}]`, textCell(origin.join(', '))]);
  }
  parts.push(table('(14mm, 1fr, 26mm, 34mm)', ['Kz', 'Angabe', String(data.calendarYear), 'Voranmeldungen'], rows, { rightHeads: [2] }));
  if (!data.assumed) parts.push(paragraph(form.notes[0] ?? ''));
  return parts;
}

export function vatSummaryTypst(data: VatSummaryReport, _ctx?: ReportRenderContext): string {
  const figures = figuresTypst(data);
  const appendix = vatSummaryByCodeTypst(data);
  return figures.length === 0 ? appendix : [...figures, heading(2, 'Anhang: nach Kennzeichen'), appendix].join('\n\n');
}

/** Die Sicht je Kennzeichen (B1) — seit E6b der Anhang; die Prüferin vergleicht weiter je Kennzeichen. */
function vatSummaryByCodeTypst(data: VatSummaryReport): string {
  const smallOnly = data.taxation.length > 0 && data.taxation.every((t) => t.taxation === 'smallBusiness');
  const notes: string[] = [];
  if (data.warnings.includes('section18_4a')) notes.push(`#block(inset: (y: 4pt))[*Hinweis:* ${paragraph('Steuer nach § 13b UStG unter Kleinunternehmerschaft: Für das Jahr ist eine Umsatzsteuererklärung abzugeben (§ 18 Abs. 4a UStG).')}]`);
  if (data.warnings.includes('taxContextMissing')) notes.push(`#block(inset: (y: 4pt))[*Hinweis:* ${paragraph('Für mindestens einen Buchungstag sind Besteuerungsform oder Steuersätze nicht hinterlegt; diese Zeilen fehlen in den Summen.')}]`);
  if (smallOnly) return [smallBusinessTypst(data), ...notes].join('\n\n');
  const parts: string[] = [heading(2, 'Besteuerungsform')];
  parts.push(table('(1fr, 60mm)', ['Zeitraum', 'Form'], data.taxation.map((t) => [textCell(`${paperDate(t.from as never)} bis ${paperDate(t.to as never)}`), textCell(TAXATION_TEXT[t.taxation])])));
  parts.push(heading(2, 'Je Kennzeichen'));
  if (data.byCode.length === 0) parts.push(paragraph('Im Kalenderjahr gibt es keine Zeilen mit Steuerkennzeichen.'));
  else {
    parts.push(
      // Jeder Kopf über einer Zahl steht rechts wie die Zahl; lange Köpfe trennen an der Silbe (Designer Runde 6, 267).
      table(
        '(1fr, 14mm, 24mm, 24mm, 22mm, 22mm, 24mm)',
        ['in €', 'Zeilen', 'Netto', 'Umsatz\u00adsteuer', '§ 13b', 'Vor\u00adsteuer', 'nicht abzieh\u00adbar'],
        data.byCode.map((c) => [
          textCell(codeText(c)),
          amountLikeCell(c.lineCount),
          amountCell(c.netCents),
          amountCell(c.outputTaxCents),
          amountCell(c.reverseChargeTaxCents),
          amountCell(c.inputTaxCents),
          amountCell(c.notDeductibleCents),
        ]),
        { rightHeads: [1, 2, 3, 4, 5, 6] },
      ),
    );
  }
  parts.push(
    table('(1fr, 32mm)', ['in €', 'Jahr'], [
      [textCell('Umsatzsteuer aus eigenen Umsätzen'), amountCell(data.totals.outputTaxCents)],
      [textCell('Steuer nach § 13b UStG und innergemeinschaftlichem Erwerb'), amountCell(data.totals.reverseChargeTaxCents)],
      [textCell('abziehbare Vorsteuer'), amountCell(-data.totals.inputTaxCents)],
      [strongCell('Zahllast'), strongAmountCell(data.totals.balanceCents)],
      [textCell('nicht abziehbare Vorsteuer (nachrichtlich)'), amountCell(data.totals.notDeductibleCents)],
    ]),
  );
  return [...parts, ...notes].join('\n\n');
}

export const vatSummaryReport: ReportDefinition<VatSummaryReport> = {
  key: 'vatSummary',
  group: 'taxOffice',
  personal: false,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearParamsSchema,
  checkParams: checkYearOrDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: computeVatSummaryReport,
  toTypst: vatSummaryTypst,
  empty: vatEmpty,
  yearKind: 'calendar',
  titleKey: 'finance.reports.vatSummary.title',
  paperTitle: 'Umsatzsteuer-Summen',
  paperPeriod: (data) => `Kalenderjahr ${data.calendarYear}`,
};
