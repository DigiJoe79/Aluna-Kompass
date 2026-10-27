import type { DbOrTx } from '@kompass/core';
import { and, eq, gte, lte } from 'drizzle-orm';
import { financeAllocationLines, financeCategories, financeEntries } from '../schema';
import { taxContextAt, taxOf, type TaxCode } from './tax';
import { vatProfileAt } from './vat-settings';

/**
 * Umsatz nach § 19 UStG — eine Rechnung für den Schwellenwächter (`closing/thresholds.ts`) und die Kennzahl der
 * § 19-Umsätze in Voranmeldung und Jahreserklärung (E6b, `reporting/reports/vat-advance-return.ts`). In `ledger/`,
 * weil beide Bereiche sie lesen.
 */

export interface TurnoverLine { entryId: string; amountCents: number; entryDate: string; sphere: string | null; direction: string; taxCode: string; rateKind: 'standard' | 'reduced'; isAssetSale: boolean; thresholdExclusion: string }

export function turnoverLinesInternal(db: DbOrTx, year: { startsOn: string; endsOn: string }): TurnoverLine[] {
  return db
    .select({ entryId: financeAllocationLines.entryId, amountCents: financeAllocationLines.amountCents, entryDate: financeEntries.entryDate, sphere: financeCategories.sphere, direction: financeCategories.direction, taxCode: financeAllocationLines.taxCode, rateKind: financeAllocationLines.rateKind, isAssetSale: financeCategories.isAssetSale, thresholdExclusion: financeCategories.thresholdExclusion })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn)))
    .all();
}

/** Umsatz nach § 19 UStG: Zeilen mit `reduced`, `standard`, `exemptCounted` außerhalb `ideal`, ohne Anlagenverkauf; unter `regular` netto. */
const countsAsTurnover = (l: TurnoverLine): boolean => l.direction === 'income' && l.sphere !== 'ideal' && !l.isAssetSale && ['reduced', 'standard', 'exemptCounted'].includes(l.taxCode);

export function turnoverOf(db: DbOrTx, lines: readonly TurnoverLine[]): number {
  return lines
    .filter(countsAsTurnover)
    .reduce((s, l) => {
      const context = taxContextAt(db, l.entryDate);
      if (!context || context.taxation === 'smallBusiness') return s + l.amountCents;
      return s + taxOf({ amountCents: l.amountCents, taxCode: l.taxCode as TaxCode, rateKind: l.rateKind, taxation: 'regular', inputTaxDeductible: 'no', rates: context.rates }).netCents;
    }, 0);
}

/**
 * Ohne Rechteprüfung (E6b, Voranmeldung Kz 48 bzw. Jahreserklärung Kz 236): die nach § 19 Abs. 1 UStG steuerfreien
 * Umsätze im Zeitraum, nach Buchungstag — dieselbe Auswahl wie `turnoverOf`, aber nur Zeilen, deren Buchungstag unter
 * Kleinunternehmerschaft eines Unternehmers liegt: § 19 Abs. 1 S. 1 UStG gilt für „Unternehmer“, der Verein ohne
 * Unternehmereigenschaft hat keine Umsätze danach, auch wenn `smallBusiness` bei ihm die Vorgabe ist (Befund 37,
 * Recherche 2026-10-26 A.5).
 */
export function section19TurnoverInternal(db: DbOrTx, range: { from: string; to: string }): number {
  return section19TurnoverWithEntriesInternal(db, range).cents;
}

/** Wie `section19TurnoverInternal`, dazu die Buchungen dahinter — die Herkunft der Kz 48 als Link (Designer Runde 8, 342). */
export function section19TurnoverWithEntriesInternal(db: DbOrTx, range: { from: string; to: string }): { cents: number; entryIds: string[] } {
  const lines = turnoverLinesInternal(db, { startsOn: range.from, endsOn: range.to }).filter((l) => taxContextAt(db, l.entryDate)?.taxation === 'smallBusiness' && vatProfileAt(db, l.entryDate).entrepreneur);
  const cents = turnoverOf(db, lines);
  return { cents, entryIds: cents === 0 ? [] : [...new Set(lines.filter(countsAsTurnover).map((l) => l.entryId))].sort() };
}

