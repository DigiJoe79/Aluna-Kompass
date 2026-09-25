import type { DbOrTx } from '@kompass/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { EntryLock } from '../locks';
import { financeAllocationLines, financeConfirmationLines, financeConfirmations } from '../schema';

/**
 * Sperren an einer Buchung, solange eine gültige Bestätigung auf einer ihrer
 * Zeilen liegt (F6a Task 5, Spec 5.4, Annahme 13): kein Storno der Buchung,
 * keine Zuordnungskorrektur des Kontakts. Projekt, Zweck und Ausland bleiben
 * korrigierbar. Nach der Rücknahme der Bestätigung (`releasedAt`) fällt beides.
 * Eingetragen in `ENTRY_LOCKS` von `manifest.ts`.
 */
function openConfirmationNumber(db: DbOrTx, entryId: string): string | null {
  const row = db
    .select({ number: financeConfirmations.documentNumber })
    .from(financeConfirmationLines)
    .innerJoin(financeAllocationLines, eq(financeConfirmationLines.lineId, financeAllocationLines.id))
    .innerJoin(financeConfirmations, eq(financeConfirmationLines.confirmationId, financeConfirmations.id))
    .where(and(eq(financeAllocationLines.entryId, entryId), isNull(financeConfirmationLines.releasedAt)))
    .limit(1)
    .get();
  return row?.number ?? null;
}

const reasonFor = (number: string) => `Bestätigung ${number} — zuerst zurücknehmen.`;

export const confirmationEntryLock: EntryLock = (db, entryId) => {
  const number = openConfirmationNumber(db, entryId);
  return number ? { scope: 'entry', reason: reasonFor(number) } : null;
};

export const confirmationContactLock: EntryLock = (db, entryId) => {
  const number = openConfirmationNumber(db, entryId);
  return number ? { scope: 'contact', reason: reasonFor(number) } : null;
};
