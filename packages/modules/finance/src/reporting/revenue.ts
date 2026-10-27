import type { DbOrTx } from '@kompass/core';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { incomeStatement } from '../ledger/queries';
import { financeAllocationLines, financeCategories, financeEntries, financeFiscalYears } from '../schema';

/**
 * Einnahmen nach § 55 Abs. 1 Nr. 5 AO (Rechenschaft C Schwellenwächter; Anlage Gem Zeile 9 in D2, später MVR) — eine
 * Funktion, eine Zusammensetzung (Spec § C): alle festgeschriebenen Einnahmezeilen des Geschäftsjahres nach
 * Buchungsdatum, mit Sach- und Aufwandsspenden und „Zuführung zum Vermögen“, ohne Anlagenverkauf, ohne erstattete
 * Umsatzsteuer, ohne durchlaufende Gelder; Rückläufer (negative Einnahmezeilen) mindern. `parts` nennt jede Größe.
 * Einnahmenbegriff nach AEAO zu § 55 Nr. 30 („alle Vermögensmehrungen“, auch Zuführungen nach § 62 Abs. 3 AO); ein
 * nicht leistungsbezogener Zuschuss (`notPerformance`) zählt hier, anders als in Zeile 10. Darlehen sind keine Einnahme —
 * Kompass kennt dafür noch kein Merkmal; sie dürfen nicht als Einnahme gebucht werden (Hinweis im Bericht).
 */
export type RevenuePartKey = 'income' | 'inKind' | 'expenseWaiver' | 'addsToAssets' | 'returns' | 'assetSales' | 'taxRefunds' | 'transit';
export interface AnnualRevenue {
  totalCents: number;
  parts: { key: RevenuePartKey; cents: number; included: boolean }[];
}

const ORDER: readonly RevenuePartKey[] = ['income', 'inKind', 'expenseWaiver', 'addsToAssets', 'returns', 'assetSales', 'taxRefunds', 'transit'];
const EXCLUDED = new Set<RevenuePartKey>(['assetSales', 'taxRefunds', 'transit']);

export function annualRevenueForGemInternal(db: DbOrTx, fiscalYearId: string): AnnualRevenue {
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  const sums = new Map<RevenuePartKey, number>(ORDER.map((k) => [k, 0]));
  if (year) {
    const rows = db
      .select({ amountCents: financeAllocationLines.amountCents, addsToAssets: financeAllocationLines.addsToAssets, direction: financeCategories.direction, incomeKind: financeCategories.incomeKind, isAssetSale: financeCategories.isAssetSale, thresholdExclusion: financeCategories.thresholdExclusion })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
      .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
      .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn)))
      .all();
    for (const r of rows) {
      const key: RevenuePartKey | null =
        r.direction === 'transit' ? (r.amountCents > 0 ? 'transit' : null)
        : r.direction !== 'income' ? null
        : r.isAssetSale ? 'assetSales'
        : r.thresholdExclusion === 'taxRefund' ? 'taxRefunds'
        : r.amountCents < 0 ? 'returns'
        : r.incomeKind === 'inKindDonation' ? 'inKind'
        // Aufwandsspenden zählen mit (BMF 25.11.2014 Nr. 5: Geldspende), als eigener Posten — manche Praxisquellen
        // rechnen sie nicht ein; so bleibt die andere Lesart sichtbar (Recherche 2026-10-25 Frage 4, Joe 2026-10-25).
        : r.incomeKind === 'expenseWaiver' ? 'expenseWaiver'
        : r.addsToAssets ? 'addsToAssets'
        : 'income';
      if (key) sums.set(key, sums.get(key)! + r.amountCents);
    }
  }
  const parts = ORDER.map((key) => ({ key, cents: sums.get(key)!, included: !EXCLUDED.has(key) }));
  return { totalCents: parts.filter((p) => p.included).reduce((s, p) => s + p.cents, 0), parts };
}

/**
 * Einnahmen der Betriebe eines Geschäftsjahres (Rechenschaft D2 Task 4, eine Funktion für Schwellenwächter und Anlage
 * Gem): festgeschriebene Einnahmezeilen der genannten Bereiche nach Buchungsdatum, brutto, ohne durchlaufende Gelder,
 * ohne Anlagenverkauf und ohne Zeilen, die die Kategorie von der Freigrenze ausnimmt (`thresholdExclusion` ≠ `none`:
 * nicht leistungsbezogen, erstattete Steuer). Einnahmenbegriff nach AEAO zu § 64 Nr. 18–20 (Fassung AO-Handbuch 2025;
 * früher Nr. 15–17). `['business']` ist die Freigrenze des § 64 Abs. 3 S. 1 AO, `['business', 'purposeOperation']`
 * die Zeile 10 der Anlage Gem und ab 2026 § 64 Abs. 3 S. 2 AO.
 */
export function operationsRevenueInternal(db: DbOrTx, fiscalYearId: string, spheres: readonly ('business' | 'purposeOperation')[]): number {
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  if (!year || spheres.length === 0) return 0;
  return db
    .select({ amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(
      and(
        eq(financeEntries.status, 'final'),
        gte(financeEntries.entryDate, year.startsOn),
        lte(financeEntries.entryDate, year.endsOn),
        eq(financeCategories.direction, 'income'),
        inArray(financeCategories.sphere, [...spheres]),
        eq(financeCategories.isAssetSale, false),
        eq(financeCategories.thresholdExclusion, 'none'),
      ),
    )
    .all()
    .reduce((sum, r) => sum + r.amountCents, 0);
}

/**
 * E6a (§ 64 Abs. 3 S. 2 AO, C1 2b): das Ergebnis aller Betriebe — wirtschaftliche Geschäftsbetriebe und Zweckbetriebe —
 * aus der Einnahmen-Überschuss-Rechnung. „Insgesamt ein Gewinn“ heißt `> 0`. Eine Quelle für den Hinweis
 * `spheresMergeable` der Steuererklärung und die Schwelle „Vereinfachung Zweckbetriebe“.
 */
export function operationsResultInternal(db: DbOrTx, range: { from: string; to: string }): number {
  return incomeStatement(db, range).spheres.filter((s) => s.sphere === 'business' || s.sphere === 'purposeOperation').reduce((sum, s) => sum + s.resultCents, 0);
}
