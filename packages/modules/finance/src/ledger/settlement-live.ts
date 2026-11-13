import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@kompass/core';
import { financeEntries, financeMoneyLines, financeOpenItemSettlements } from '../schema';

/**
 * Spec Zahlung zuordnen § 3.1: Ein **lebender** Ausgleich ist nicht aufgehoben (`released_at` leer). Die zweite Hälfte
 * — Buchung festgeschrieben und nicht zurückgenommen — prüft jeder Leser dort, wo er sie heute prüft (Entwürfe lesen
 * manche bewusst mit). Jede Abfrage auf `financeOpenItemSettlements` nimmt diese Bedingung in ihr `where`; der Wächter
 * `tests/live-settlements.test.ts` hält das fest. Eigene Datei, damit jeder Bereich sie ohne Zyklus importiert.
 */
export function liveSettlementCondition(): SQL {
  return isNull(financeOpenItemSettlements.releasedAt);
}

/**
 * Zeigt ein Rück-Ausgleich einer nicht zurückgenommenen Buchung (auch eines Entwurfs) auf diesen Ausgleich — ist also
 * eine Rückgabe gebucht oder vorbereitet? Dann bleibt eine Zuordnung stehen (`assignmentHasReturn`, Spec § 3.3).
 */
export function settlementHasReturnInternal(db: DbOrTx, settlementId: string): boolean {
  return !!db
    .select({ id: financeOpenItemSettlements.id })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(and(eq(financeOpenItemSettlements.reversesSettlementId, settlementId), isNull(financeEntries.reversedByEntryId), liveSettlementCondition()))
    .get();
}
