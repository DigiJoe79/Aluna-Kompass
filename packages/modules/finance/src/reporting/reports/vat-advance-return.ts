import { invalid, type DbOrTx, type Failure } from '@kompass/core';
import { and, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../../errors';
import { taxContextAt, taxOf, type Taxation } from '../../ledger/tax';
import { parseVatPeriod, vatAdvancePeriodKindInternal, type VatPeriodRange } from '../../ledger/vat-periods';
import { vatFigureValuesInternal, type VatFigureValue } from '../../ledger/vat-figures';
import { financeFiscalYears } from '../../schema';
import { formatAmount } from '../../format/amount';
import { euroBase, VAT_FIGURE_GROUP_TITLES, vatFormFor, vatFormNotes, type VatFigure, type VatFigureSource, type VatForm } from '../vat-forms';
import type { ReportDefinition, ReportParams } from '../types';
import { heading, paragraph, spanRow, table, textCell } from './common';

/**
 * Umsatzsteuer-Voranmeldung je Zeitraum (Spec E6 Teil 5, Plan E6b Task 5): die Werte zum Übertragen in ELSTER nach den
 * Kennzahlen der Fassung des Jahres (`vat-forms.ts`). Gehasht sind nur die Werte je Quelle des Zeitraums — Frist,
 * Abgabe und Berichtigung liest die Seite über `listVatPeriods` dazu, sonst veraltete jede festgeschriebene Fassung mit
 * der Abgabe. Bemessungsgrundlagen in vollen Euro (Cent abgeschnitten), Steuer mit Cent, Steuer je Satz auf die Summe.
 * Festschreibbar nach Ende des Zeitraums, auch im offenen Geschäftsjahr (`periodEnd`).
 */

export { VAT_FIGURE_SOURCES, vatFigureValuesInternal, vatFiguresOfPeriodInternal, type VatFigureValue } from '../../ledger/vat-figures';

/** Gehasht: nur die Werte des Zeitraums. */
export interface VatAdvanceReturnData {
  period: VatPeriodRange;
  formYear: number;
  taxation: Taxation;
  values: VatFigureValue[];
}

// ── Parameter ──────────────────────────────────────────────────────────────

const paramsSchema: z.ZodType<ReportParams> = z.object({ vatPeriod: z.string().regex(/^\d{4}-(Q[1-4]|0[1-9]|1[0-2])$/) }).strict();

const rangeOf = (params: ReportParams): VatPeriodRange => parseVatPeriod(params.vatPeriod!)!;

function yearsOf(db: DbOrTx, params: ReportParams): string[] {
  const range = params.vatPeriod ? parseVatPeriod(params.vatPeriod) : null;
  if (!range) return [];
  return db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(and(lte(financeFiscalYears.startsOn, range.endsOn), gte(financeFiscalYears.endsOn, range.startsOn))).all().map((y) => y.id);
}

/** Zeitraumart des Jahres, Fassung vorhanden, ein Geschäftsjahr im Zeitraum. */
function checkParams(db: DbOrTx, params: ReportParams): Failure | null {
  const range = params.vatPeriod ? parseVatPeriod(params.vatPeriod) : null;
  if (!range || range.kind === 'year') return invalid([{ path: 'vatPeriod', message: 'invalid' }]);
  const year = Number(range.key.slice(0, 4));
  if (!vatFormFor('advance', year)) return financeConflict('vatFormMissing', { year: String(year) });
  if (range.kind !== vatAdvancePeriodKindInternal(db, year)) return invalid([{ path: 'vatPeriod', message: 'wrongPeriodKind' }]);
  if (yearsOf(db, params).length === 0) return invalid([{ path: 'vatPeriod', message: 'noFiscalYear' }]);
  return null;
}

export function computeVatAdvanceReturn(db: DbOrTx, params: ReportParams): VatAdvanceReturnData {
  const period = rangeOf(params);
  const formYear = Number(period.key.slice(0, 4));
  const taxation = (taxContextAt(db, period.endsOn)?.taxation ?? 'smallBusiness') as Taxation;
  return { period, formYear, taxation, values: vatFigureValuesInternal(db, { from: period.startsOn, to: period.endsOn }) };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** „2. Quartal 2026“, „Mai 2026“ — Papier, deutsch (Prinzip 7). */
export function vatPeriodPaperLabel(key: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(key);
  if (q) return `${q[2]}. Quartal ${q[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return key;
}

/** Kurz wie auf der Seite der Voranmeldung: „Q2 2026“, ein Monat ausgeschrieben („Mai 2026“). */
export function vatPeriodShortLabel(key: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(key);
  return q ? `Q${q[2]} ${q[1]}` : vatPeriodPaperLabel(key);
}

const TAXATION_TEXT: Record<Taxation, string> = { smallBusiness: 'Kleinunternehmer (§ 19 UStG)', regular: 'Regelbesteuerung' };

/** Die Kennzahlen der Fassung zur Besteuerung des Zeitraums. */
export function vatFiguresFor(form: VatForm, taxation: Taxation): VatFigure[] {
  return form.figures.filter((f) => f.taxation === undefined || f.taxation === taxation);
}

/** Der Wert einer Kennzahl wie in ELSTER: Bemessungsgrundlage in vollen Euro, Steuer mit Cent. */
export function vatFigureText(figure: VatFigure, cents: number): string {
  if (figure.unit === 'flag') return String(cents);
  if (figure.unit === 'euro') return formatAmount(euroBase(cents) * 100).replace(/,00$/, '');
  return formatAmount(cents);
}

const EMPTY_TEXT = 'Im Zeitraum gibt es keine Umsätze mit Umsatzsteuer.';

function shownFigures(data: VatAdvanceReturnData): { figure: VatFigure; cents: number }[] {
  const form = vatFormFor('advance', data.formYear);
  if (!form) return [];
  const byCents = new Map(data.values.map((v) => [v.source, v.cents]));
  // Kz 10 kennt erst die Seite (Berichtigung); der Bericht zeigt sie nicht.
  return vatFiguresFor(form, data.taxation)
    .filter((f) => f.source !== 'amended')
    .map((figure) => ({ figure, cents: byCents.get(figure.source) ?? 0 }))
    .filter(({ figure, cents }) => (figure.unit === 'euro' ? euroBase(cents) !== 0 : cents !== 0));
}

function vatAdvanceEmpty(data: VatAdvanceReturnData): string | null {
  return shownFigures(data).length === 0 ? EMPTY_TEXT : null;
}

export function vatAdvanceReturnTypst(data: VatAdvanceReturnData): string {
  const form = vatFormFor('advance', data.formYear);
  const parts = [paragraph(`Zeitraum: ${vatPeriodPaperLabel(data.period.key)} · Besteuerung: ${TAXATION_TEXT[data.taxation]}`)];
  const shown = shownFigures(data);
  if (shown.length === 0) return [...parts, paragraph(EMPTY_TEXT)].join('\n\n');
  parts.push(heading(2, 'Kennzahlen'));
  const rows: string[][] = [];
  let group: string | null = null;
  for (const { figure, cents } of shown) {
    if (figure.group !== group) {
      group = figure.group;
      rows.push([spanRow(3, VAT_FIGURE_GROUP_TITLES[figure.group])]);
    }
    rows.push([textCell(figure.code), textCell(figure.label), `table.cell(align: right)[${vatFigureText(figure, cents)}]`]);
  }
  parts.push(table('(14mm, 1fr, 28mm)', ['Kz', 'Angabe', 'Wert'], rows, { rightHeads: [2] }));
  for (const note of vatFormNotes(form, data.taxation)) parts.push(paragraph(note));
  return parts.join('\n\n');
}

export const vatAdvanceReturnReport: ReportDefinition<VatAdvanceReturnData> = {
  key: 'vatAdvanceReturn',
  group: 'taxOffice',
  personal: false,
  available: true,
  orientation: 'portrait',
  paramsSchema,
  checkParams,
  years: yearsOf,
  periodEnd: (params) => {
    const range = params.vatPeriod ? parseVatPeriod(params.vatPeriod) : null;
    return range ? { key: range.key, endsOn: range.endsOn } : null;
  },
  // Die Voranmeldung hat ihre eigene Seite (Rechenschaft → Umsatzsteuer); „Berichte“ zeigt je Jahr nur die Summen.
  paramsForYear: () => null,
  compute: (db, params) => computeVatAdvanceReturn(db, params),
  toTypst: (data) => vatAdvanceReturnTypst(data),
  empty: vatAdvanceEmpty,
  titleKey: 'finance.reports.vatAdvanceReturn.title',
  paperTitle: 'Umsatzsteuer-Voranmeldung',
  paperPeriod: (data) => vatPeriodPaperLabel(data.period.key),
};
