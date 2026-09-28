import type { DbOrTx } from '@kompass/core';
import { and, eq, ne, sql } from 'drizzle-orm';
import { financeAllocationLines, financeCategories, financeEntries } from '../schema';
import { valueAt } from './dated-values';

export type AllowanceKind = 'volunteer' | 'trainer';

/** Die Reihe der Jahresgrenze je Pauschale (§ 3 Nr. 26a/26 EStG) — zum 31.12. des Kalenderjahres. */
export function allowanceCapCents(db: DbOrTx, kind: AllowanceKind, year: number): number {
  return (valueAt(db, kind === 'volunteer' ? 'allowanceVolunteer' : 'allowanceTrainer', `${year}-12-31`) as number | null) ?? 0;
}

/** Befund AI: was über der Grenze liegt — `0`, solange nicht überschritten (oder keine Grenze hinterlegt ist). */
export function overCapCents(totalCents: number, capCents: number): number {
  return capCents > 0 && totalCents > capCents ? totalCents - capCents : 0;
}

/**
 * Pauschalen einer Person und Art im Kalenderjahr der Zahlung, aus
 * festgeschriebenen Buchungen — dieselbe Zählung wie die Personenübersicht
 * (Zahlungen positiv).
 */
export function allowanceTotalCents(db: DbOrTx, contactId: string, kind: AllowanceKind, year: number): number {
  return (
    db
      .select({ sumCents: sql<number>`coalesce(sum(-${financeAllocationLines.amountCents}), 0)` })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
      .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
      .where(and(eq(financeEntries.status, 'final'), ne(financeCategories.allowanceKind, 'none'), eq(financeCategories.allowanceKind, kind), eq(financeAllocationLines.contactId, contactId), sql`${financeEntries.entryDate} >= ${`${year}-01-01`} and ${financeEntries.entryDate} <= ${`${year}-12-31`}`))
      .get()?.sumCents ?? 0
  );
}
