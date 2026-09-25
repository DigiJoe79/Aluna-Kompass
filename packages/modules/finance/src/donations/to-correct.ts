import type { DbOrTx } from '@kompass/core';
import { eq, inArray, isNull } from 'drizzle-orm';
import { financeAllocationLines, financeConfirmationLines, financeConfirmations, financeEntries, financeNotices, type FinanceConfirmationRow } from '../schema';
import { returnedCentsInternal } from './check';

/**
 * „Zu korrigieren“ (F6a Task 5, Annahme 3) — berechnet, nie gespeichert. Eine
 * nicht zurückgenommene Bestätigung trifft es, wenn
 * (a) ihr Bescheid inzwischen aufgehoben oder ersetzt (`noticeSuperseded`)
 *     oder als irrtümlich erfasst gekennzeichnet ist (`noticeVoided`),
 * (b) eine ihrer Zeilen zurückgenommen ist (`lineReversed`) oder eine
 *     Rückbuchung auf sie zeigt (`lineReturned`),
 * (c) der Kontakt einer ihrer Zeilen nicht mehr der der Bestätigung ist
 *     (`contactChanged`, nach einer angewandten Zuordnungskorrektur).
 * Eine geänderte Anschrift am Kontakt zählt nicht: Die Bestätigung war am
 * Ausstellungstag richtig.
 */
export type ToCorrectReason = 'noticeSuperseded' | 'noticeVoided' | 'lineReversed' | 'lineReturned' | 'contactChanged';

export function toCorrectReasonsInternal(db: DbOrTx, confirmation: FinanceConfirmationRow): ToCorrectReason[] {
  if (confirmation.voidedAt !== null) return [];
  const reasons: ToCorrectReason[] = [];

  const notice = db.select({ supersededOn: financeNotices.supersededOn, voidedAt: financeNotices.voidedAt }).from(financeNotices).where(eq(financeNotices.id, confirmation.noticeId)).get();
  if (notice?.voidedAt) reasons.push('noticeVoided');
  else if (notice?.supersededOn) reasons.push('noticeSuperseded');

  const lineIds = db.select({ lineId: financeConfirmationLines.lineId }).from(financeConfirmationLines).where(eq(financeConfirmationLines.confirmationId, confirmation.id)).all().map((r) => r.lineId);
  if (lineIds.length === 0) return reasons;
  const lines = db
    .select({ id: financeAllocationLines.id, contactId: financeAllocationLines.contactId, reversedByEntryId: financeEntries.reversedByEntryId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(inArray(financeAllocationLines.id, lineIds))
    .all();
  if (lines.some((l) => l.reversedByEntryId !== null)) reasons.push('lineReversed');
  const returned = returnedCentsInternal(db, lineIds);
  if (lineIds.some((id) => (returned.get(id) ?? 0) > 0)) reasons.push('lineReturned');
  if (lines.some((l) => l.contactId !== confirmation.contactId)) reasons.push('contactChanged');
  return reasons;
}

/** Die nicht zurückgenommenen Bestätigungen mit mindestens einem Grund — für Kachel und Liste. */
export function toCorrectConfirmationsInternal(db: DbOrTx): { confirmation: FinanceConfirmationRow; reasons: ToCorrectReason[] }[] {
  return db
    .select()
    .from(financeConfirmations)
    .where(isNull(financeConfirmations.voidedAt))
    .all()
    .map((confirmation) => ({ confirmation, reasons: toCorrectReasonsInternal(db, confirmation) }))
    .filter((c) => c.reasons.length > 0);
}

export function countToCorrectInternal(db: DbOrTx): number {
  return toCorrectConfirmationsInternal(db).length;
}
