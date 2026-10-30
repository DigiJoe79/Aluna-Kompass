import type { DbOrTx } from '@kompass/core';
import { and, eq, lte, sql } from 'drizzle-orm';
import { financeAllocationLines, financeCategories, financeEntries } from '../schema';

/**
 * Vermögen nach § 62 Abs. 3 AO am Stichtag (Jahresrechnung F5, Plan J1 Entscheidung 10): Σ festgeschriebener
 * Einnahmezeilen mit „Zuführung zum Vermögen“ (`addsToAssets`) bis einschließlich `date`. Kompass führt das Vermögen
 * nicht als Bestand; die Summe der Zuführungen ist die genannte Annahme (Methodik-Anhang).
 */
export function endowmentAtInternal(db: DbOrTx, date: string): number {
  return (
    db
      .select({ sum: sql<number>`coalesce(sum(${financeAllocationLines.amountCents}), 0)` })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
      .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
      .where(and(eq(financeEntries.status, 'final'), eq(financeCategories.direction, 'income'), eq(financeAllocationLines.addsToAssets, true), lte(financeEntries.entryDate, date)))
      .get()?.sum ?? 0
  );
}
