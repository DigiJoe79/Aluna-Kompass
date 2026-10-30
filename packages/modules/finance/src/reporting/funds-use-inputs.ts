import type { DbOrTx } from '@kompass/core';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { fundsUseOpeningsInternal } from '../allocation/funds-use-openings';
import { fundsUseChain, fundsUseObligation, type FundsUseChainOptions, type FundsUseYearInput, type FundsUseYearResult } from '../allocation/funds-use-rules';
import { valueAt } from '../ledger/dated-values';
import { financeAllocationLines, financeCategories, financeEntries, financeFiscalYears, financeReserveMovements, type FinanceFiscalYearRow } from '../schema';
import { annualRevenueForGemInternal } from './revenue';

/**
 * Eingaben der Mittelverwendungsrechnung aus dem Bestand (M1 Task 4): festgeschriebene Zeilen nach Buchungsdatum im
 * Geschäftsjahr, durchlaufende Gelder nie; Zuführungen zum Vermögen (`addsToAssets`) nur nachrichtlich. Rücklagenvorgänge
 * nach Vorgangstag — so wirkt eine nachträgliche Bildung (§ 62 Abs. 2 AO) in dem Jahr, in dem sie beschlossen wird, und
 * eine festgeschriebene Rechnung ihres Bezugsjahres bleibt unverändert (Prüfung L-3).
 */
export function fundsUseYearInputInternal(db: DbOrTx, year: FinanceFiscalYearRow): FundsUseYearInput {
  const lines = db
    .select({ amountCents: financeAllocationLines.amountCents, addsToAssets: financeAllocationLines.addsToAssets, direction: financeCategories.direction, sphere: financeCategories.sphere, isAssetSale: financeCategories.isAssetSale })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn)))
    .all();
  let idealIncomeCents = 0;
  let idealExpenseCents = 0;
  let assetSalesCents = 0;
  let endowmentCents = 0;
  const result = { assetManagement: 0, purposeOperation: 0, business: 0 };
  for (const l of lines) {
    if (l.direction === 'transit') continue;
    if (l.direction === 'income' && l.addsToAssets) {
      endowmentCents += l.amountCents;
      continue;
    }
    if (l.direction === 'income' && l.isAssetSale) assetSalesCents += l.amountCents;
    if (l.sphere === 'ideal') {
      if (l.direction === 'income') idealIncomeCents += l.amountCents;
      else idealExpenseCents -= l.amountCents;
    } else if (l.sphere === 'assetManagement' || l.sphere === 'purposeOperation' || l.sphere === 'business') {
      result[l.sphere] += l.amountCents;
    }
  }

  const years = new Map(db.select({ id: financeFiscalYears.id, endsOn: financeFiscalYears.endsOn }).from(financeFiscalYears).all().map((y) => [y.id, y.endsOn]));
  const movements = db.select().from(financeReserveMovements).where(and(gte(financeReserveMovements.movementDate, year.startsOn), lte(financeReserveMovements.movementDate, year.endsOn))).all();
  let reserveReleasesCents = 0;
  let reserveAllocationsCents = 0;
  const late = new Map<string, number>();
  for (const m of movements) {
    if (m.kind !== 'allocate') {
      reserveReleasesCents += m.amountCents;
      continue;
    }
    const originEndsOn = m.forFiscalYearId ? years.get(m.forFiscalYearId) : undefined;
    if (m.forFiscalYearId && m.forFiscalYearId !== year.id && originEndsOn !== undefined && originEndsOn < year.startsOn) {
      const key = `fy:${m.forFiscalYearId}`;
      late.set(key, (late.get(key) ?? 0) + m.amountCents);
    } else reserveAllocationsCents += m.amountCents;
  }

  return {
    fiscalYearId: year.id,
    designation: year.designation,
    endsOn: year.endsOn,
    revenueCents: annualRevenueForGemInternal(db, year.id).totalCents,
    limitCents: (valueAt(db, 'thresholdTimelyUse', year.endsOn) as number | null) ?? null,
    idealIncomeCents,
    assetSalesCents,
    endowmentCents,
    assetManagementResultCents: result.assetManagement,
    purposeOperationResultCents: result.purposeOperation,
    businessResultCents: result.business,
    idealExpenseCents,
    reserveReleasesCents,
    reserveAllocationsCents,
    lateAllocations: [...late].map(([originKey, cents]) => ({ originKey, cents })),
  };
}

/** Die Fortschreibung vom ersten Geschäftsjahr bis einschließlich `untilFiscalYearId`, nach `startsOn`. */
export function fundsUseChainInternal(db: DbOrTx, untilFiscalYearId: string, opts: FundsUseChainOptions = {}): FundsUseYearResult[] {
  const all = db.select().from(financeFiscalYears).orderBy(asc(financeFiscalYears.startsOn)).all();
  const until = all.findIndex((y) => y.id === untilFiscalYearId);
  if (until < 0) return [];
  return fundsUseChain(all.slice(0, until + 1).map((y) => fundsUseYearInputInternal(db, y)), fundsUseOpeningsInternal(db), opts);
}

/**
 * Ob die zeitnahe Verwendung für das Jahr geboten ist (Einnahmen über der Grenze oder keine Grenze) — für M2. Die Pflicht
 * hängt nur am Jahr selbst, nicht an der Fortschreibung; daher ohne Kette (Jahresabschluss und Prüfpaket fragen oft).
 */
export function fundsUseAppliesInternal(db: DbOrTx, fiscalYearId: string): boolean {
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  if (!year) return false;
  return fundsUseObligation(annualRevenueForGemInternal(db, year.id).totalCents, (valueAt(db, 'thresholdTimelyUse', year.endsOn) as number | null) ?? null) === 'required';
}
