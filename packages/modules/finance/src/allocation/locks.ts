import type { DbOrTx } from '@kompass/core';
import { eq, inArray } from 'drizzle-orm';
import type { EntryLock } from '../locks';
import { financeAllocationLines, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, financePartnerPaidLines, financePartnerPayments, type FinancePartnerPaymentRow } from '../schema';

/**
 * Sperren an einer Buchung durch eine Zahlung an Partner (F7 Task 4, Spec
 * 8.1, Annahme 15): eine Zeile, die einem nicht mehr im Entwurf stehenden
 * Vorgang als bezahlte Zeile gilt, sperrt Storno der Buchung **und**
 * Zuordnungskorrektur ihres Kontakts — nachträglich zugeordnete Zeilen
 * gehören zum Vorgang, solange er nicht (durch eine Kopie) freigegeben wird.
 * Die zahlende Buchung eines üblich freigegebenen Vorgangs sperrt zusätzlich
 * gegen Storno, sobald die Nachweise anerkannt sind — vorher darf ein
 * Fehler noch zurückgenommen werden. Eingetragen in `ENTRY_LOCKS` von
 * `manifest.ts`; kein Import aus `donations/`.
 */

/** Befund 49: Code und Parameter statt eines Satzes; ohne Nummer wartet der Vorgang noch auf Freigabe. */
function lockOf(scope: 'entry' | 'contact', payment: Pick<FinancePartnerPaymentRow, 'number' | 'id'>): ReturnType<EntryLock> {
  if (payment.number) return { scope, code: scope === 'entry' ? 'entryLockedByPartnerPayment' : 'contactLockedByPartnerPayment', params: { payment: payment.number } };
  return { scope, code: scope === 'entry' ? 'entryLockedByPendingPartnerPayment' : 'contactLockedByPendingPartnerPayment', params: { payment: payment.id } };
}

/** Der (nicht im Entwurf stehende) Vorgang, dessen Paid-Lines auf eine Zeile dieser Buchung zeigen. */
function paidLinePaymentOf(db: DbOrTx, entryId: string): FinancePartnerPaymentRow | null {
  const lineIds = db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).all().map((l) => l.id);
  if (lineIds.length === 0) return null;
  const claims = db.select({ paymentId: financePartnerPaidLines.paymentId }).from(financePartnerPaidLines).where(inArray(financePartnerPaidLines.paidLineId, lineIds)).all();
  for (const claim of claims) {
    const payment = db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, claim.paymentId)).get();
    if (payment && payment.state !== 'draft') return payment;
  }
  return null;
}

export const partnerPaidLineEntryLock: EntryLock = (db, entryId) => {
  const payment = paidLinePaymentOf(db, entryId);
  return payment ? lockOf('entry', payment) : null;
};

export const partnerPaidLineContactLock: EntryLock = (db, entryId) => {
  const payment = paidLinePaymentOf(db, entryId);
  return payment ? lockOf('contact', payment) : null;
};

/** Die zahlende Buchung eines üblichen (nicht nachträglichen) Vorgangs, dessen Nachweise schon anerkannt sind. */
export const partnerPayingEntryLock: EntryLock = (db, entryId) => {
  const moneyLineIds = db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).all().map((l) => l.id);
  if (moneyLineIds.length === 0) return null;
  const settlements = db.select({ openItemId: financeOpenItemSettlements.openItemId }).from(financeOpenItemSettlements).where(inArray(financeOpenItemSettlements.moneyLineId, moneyLineIds)).all();
  for (const settlement of settlements) {
    const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, settlement.openItemId)).get();
    if (item?.originType !== 'financePartnerPayment' || !item.originId) continue;
    const payment = db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, item.originId)).get();
    if (payment?.acknowledgedAt) return lockOf('entry', payment);
  }
  return null;
};
