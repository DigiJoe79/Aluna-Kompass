import type { DbOrTx } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { financeAllocationLines, financeCategories } from '../schema';
import { taxContextAt, taxOf } from './tax';
import { section19TurnoverWithEntriesInternal } from './turnover';
import { VAT_FIGURE_SOURCES, type VatFigureSource } from './vat-figure-sources';
import { parseVatPeriod, vatPeriodLinesInternal, type VatPartOverride, type VatPeriodLine } from './vat-periods';

/**
 * Die Kennzahlen der Umsatzsteuer je Quelle über einen Zeitraum (Plan E6b Task 5). In `ledger/`, seit die Berichtigung
 * (N14) sie vergleicht: Buchen und Korrektur fragen danach, und `ledger/` kennt `reporting/` nicht. Bericht der
 * Voranmeldung, Jahreswerte und das Abbild an der Abgabe lesen von hier.
 */

export { VAT_FIGURE_SOURCES, vatFiguresDiffer, type VatFigureSource } from './vat-figure-sources';

export interface VatFigureValue {
  source: VatFigureSource;
  cents: number;
  entryIds: string[];
}

/**
 * Ohne Rechteprüfung: die Werte je Quelle über einen Zeitraum — Quelle für Bericht, Abbild bei der Abgabe und Jahreswerte.
 * Jede Zeile rechnet mit Besteuerungsform und Sätzen ihres Entstehungstags; die Richtung der Kategorie bestimmt, was
 * Einnahme und was Ausgabe ist, das Vorzeichen der Zeile mindert nur (Rücknahme, Erstattung — wie `vatSummary`).
 */
export function vatFigureValuesInternal(db: DbOrTx, range: { from: string; to: string }, override?: VatPartOverride): VatFigureValue[] {
  const lines = override ? withOverride(db, vatPeriodLinesInternal(db, range), range, override) : vatPeriodLinesInternal(db, range);
  const categories = new Map(db.select({ id: financeCategories.id, direction: financeCategories.direction, inputTaxDeductible: financeCategories.inputTaxDeductible }).from(financeCategories).all().map((c) => [c.id, c] as const));
  const cents = new Map<VatFigureSource, number>(VAT_FIGURE_SOURCES.map((s) => [s, 0]));
  const entries = new Map<VatFigureSource, Set<string>>(VAT_FIGURE_SOURCES.map((s) => [s, new Set<string>()]));
  const add = (source: VatFigureSource, value: number, entryId: string) => {
    if (value === 0) return;
    cents.set(source, cents.get(source)! + value);
    entries.get(source)!.add(entryId);
  };
  // Steuer auf die Summe je Satz: eigene Umsätze (Netto), § 13b und Erwerb (Bemessungsgrundlage), abziehbare § 13b-Vorsteuer.
  const sums = new Map<string, { kind: 'output' | 'rc13bEu' | 'rc13bOther' | 'icAcquisition' | 'inputRc' | 'inputAcq'; rate: number; base: number; entryIds: Set<string> }>();
  const sum = (kind: Parameters<typeof sums.set>[1]['kind'], rate: number, base: number, entryId: string) => {
    const key = `${kind}|${rate}`;
    const group = sums.get(key) ?? { kind, rate, base: 0, entryIds: new Set<string>() };
    group.base += base;
    group.entryIds.add(entryId);
    sums.set(key, group);
  };

  for (const line of lines) {
    const context = taxContextAt(db, line.taxPointOn);
    const category = categories.get(line.categoryId);
    if (!context || !category) continue;
    const gross = Math.abs(line.amountCents);
    const asIncome = category.direction === 'income' || (category.direction !== 'expense' && line.amountCents > 0);
    const normalized = asIncome ? gross : -gross;
    const factor = line.amountCents === 0 ? 0 : Math.sign(line.amountCents) === Math.sign(normalized) ? 1 : -1;
    const regular = context.taxation === 'regular';
    const deductible = category.inputTaxDeductible;
    const code = line.taxCode;
    if (code === 'standard' || code === 'reduced') {
      const t = taxOf({ amountCents: normalized, taxCode: code, rateKind: code, taxation: context.taxation, inputTaxDeductible: deductible, rates: context.rates });
      if (asIncome && regular) {
        const net = factor * Math.abs(t.netCents);
        add(code === 'standard' ? 'ownStandardBase' : 'ownReducedBase', net, line.entryId);
        sum('output', context.rates[code], net, line.entryId);
      } else if (!asIncome) add('inputTax', factor * t.inputTaxCents, line.entryId);
    } else if (code === 'exemptCounted' || code === 'exemptNotCounted') {
      if (asIncome && regular) {
        add('exemptTurnover', factor * gross, line.entryId);
        add(code === 'exemptCounted' ? 'exemptCountedTurnover' : 'exemptNotCountedTurnover', factor * gross, line.entryId);
      }
    } else if (code === 'rc13bEu' || code === 'rc13bOther' || code === 'icAcquisition') {
      const base = -line.amountCents;
      const rate = context.rates[line.rateKind];
      if (code === 'icAcquisition') add(line.rateKind === 'reduced' ? 'acquisitionReducedBase' : 'acquisitionStandardBase', base, line.entryId);
      else add(code === 'rc13bEu' ? 'rc13bEuBase' : 'rc13bOtherBase', base, line.entryId);
      sum(code, rate, base, line.entryId);
      if (regular && deductible === 'yes') sum(code === 'icAcquisition' ? 'inputAcq' : 'inputRc', rate, base, line.entryId);
    }
  }

  const TAX_SOURCE = { output: null, rc13bEu: 'rc13bEuTax', rc13bOther: 'rc13bOtherTax', icAcquisition: 'acquisitionTax', inputRc: 'inputTaxReverseCharge', inputAcq: 'inputTaxAcquisition' } as const;
  let outputTax = 0;
  for (const group of sums.values()) {
    const tax = Math.round((group.base * group.rate) / 100);
    const source = TAX_SOURCE[group.kind];
    if (source === null) {
      outputTax += tax;
      continue;
    }
    cents.set(source, cents.get(source)! + tax);
    if (tax !== 0) for (const id of group.entryIds) entries.get(source)!.add(id);
  }

  const smallBusiness = section19TurnoverWithEntriesInternal(db, range);
  cents.set('smallBusinessTurnover', smallBusiness.cents);
  for (const id of smallBusiness.entryIds) entries.get('smallBusinessTurnover')!.add(id);
  const v = (s: VatFigureSource) => cents.get(s)!;
  cents.set('result', outputTax + v('rc13bEuTax') + v('rc13bOtherTax') + v('acquisitionTax') - v('inputTax') - v('inputTaxAcquisition') - v('inputTaxReverseCharge'));
  return VAT_FIGURE_SOURCES.map((source) => ({ source, cents: cents.get(source)!, entryIds: [...entries.get(source)!].sort() }));
}

/**
 * Die Zeilen eines Zeitraums, wie sie nach einer beantragten Korrektur stünden (N8/N14): die Zeile gleicher ID ersetzt,
 * oder weg, wenn ihr Kennzeichen `none` wird oder ihr Entstehungstag aus dem Zeitraum fällt — dieselbe Regel wie
 * `vatPeriodPartsInternal`.
 */
function withOverride(db: DbOrTx, lines: readonly VatPeriodLine[], range: { from: string; to: string }, override: VatPartOverride): VatPeriodLine[] {
  const rest = lines.filter((l) => l.lineId !== override.lineId);
  if (override.taxCode === 'none' || override.entryDate < range.from || override.taxPointOn < range.from || override.taxPointOn > range.to) return rest;
  const own = db.select({ entryId: financeAllocationLines.entryId, categoryId: financeAllocationLines.categoryId, serviceDate: financeAllocationLines.serviceDate }).from(financeAllocationLines).where(eq(financeAllocationLines.id, override.lineId)).get();
  if (!own) return rest;
  return [...rest, { lineId: override.lineId, entryId: own.entryId, categoryId: own.categoryId, serviceDate: own.serviceDate, taxCode: override.taxCode, rateKind: override.rateKind, amountCents: override.amountCents, entryDate: override.entryDate, taxPointOn: override.taxPointOn }];
}

/** Ohne Rechteprüfung: die Kennzahlen eines Umsatzsteuer-Zeitraums (`'YYYY-Qn'`, `'YYYY-MM'`, `'YYYY'`) je Quelle in Cent. */
export function vatFiguresOfPeriodInternal(db: DbOrTx, periodKey: string, override?: VatPartOverride): Record<string, number> {
  const range = parseVatPeriod(periodKey);
  if (!range) throw new Error(`Kein Umsatzsteuer-Zeitraum: ${periodKey}`);
  return Object.fromEntries(vatFigureValuesInternal(db, { from: range.startsOn, to: range.endsOn }, override).map((v) => [v.source, v.cents]));
}

