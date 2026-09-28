import type { DbOrTx, Failure } from '@kompass/core';
import { and, eq, isNull } from 'drizzle-orm';
import { financeConflict } from '../errors';
import { financeAllocationLines, financeCategories, financeEntries } from '../schema';

/**
 * Fremdes Geld nach Betrag (AF, Nachtrag Rest 0.2.0): ein Eingang auf einer Durchlauf-Kategorie ist erst
 * erledigt, wenn die Weitergaben, die mit `originLineId` auf ihn zeigen, ihn decken — und keine gibt mehr
 * weiter, als offen ist. Geteilt von `import/transit.ts` und dem Festschreiben.
 */

/** Buchungen, die weder zurückgenommen noch selbst eine Rücknahme sind — Entwürfe zählen mit. */
export const liveEntry = () => and(isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId));

/**
 * AF: die Summe der Weitergaben (positiv), die mit `originLineId` auf einen Eingang fremden Gelds zeigen —
 * an lebenden Buchungen, Entwürfe eingeschlossen; `exceptEntryId` lässt die Buchung aus, die gerade geprüft wird.
 */
export function passedOnCentsInternal(db: DbOrTx, receiptLineId: string, exceptEntryId?: string): number {
  return db
    .select({ amountCents: financeAllocationLines.amountCents, entryId: financeAllocationLines.entryId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .where(and(eq(financeAllocationLines.originLineId, receiptLineId), liveEntry()))
    .all()
    .filter((r) => r.entryId !== exceptEntryId)
    .reduce((sum, r) => sum - r.amountCents, 0);
}

/**
 * AF, beim Festschreiben: Keine Buchung gibt von einem Eingang fremden Gelds mehr weiter, als offen ist —
 * gleich, auf welchem Weg sie entstand. Nur Zeilen auf einer Durchlauf-Kategorie, die auf einen Eingang zeigen.
 */
export function foreignMoneyOverpaidInternal(db: DbOrTx, entryId: string, lines: readonly { amountCents: number; originLineId: string | null }[]): Failure | null {
  const byOrigin = new Map<string, number>();
  for (const l of lines) if (l.originLineId) byOrigin.set(l.originLineId, (byOrigin.get(l.originLineId) ?? 0) - l.amountCents);
  if (byOrigin.size === 0) return null;
  for (const [originLineId, amount] of byOrigin) {
    const origin = db
      .select({ amountCents: financeAllocationLines.amountCents, direction: financeCategories.direction })
      .from(financeAllocationLines)
      .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
      .where(eq(financeAllocationLines.id, originLineId))
      .get();
    if (!origin || origin.direction !== 'transit' || origin.amountCents <= 0) continue;
    const open = origin.amountCents - passedOnCentsInternal(db, originLineId, entryId);
    if (amount > open) return financeConflict('foreignMoneyOverpaid', { amount, open });
  }
  return null;
}
