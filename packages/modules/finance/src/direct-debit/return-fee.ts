import type { DbOrTx } from '@kompass/core';
import { and, eq, isNull } from 'drizzle-orm';
import { financeDirectDebitReturns, financeEntries, financeMoneyLines, financeRawTransactions, type FinanceDirectDebitReturnRow } from '../schema';

const fold = (value: string | null) => (value ?? '').toLowerCase().replace(/ü/g, 'ue').replace(/ä/g, 'ae').replace(/ö/g, 'oe');

/**
 * M37 (Spec § 7.7): Ist ein Abgang das Entgelt einer Rückgabe, das die Bank als eigene Buchung schickt („Entgelt
 * Rücklastschrift“)? Am Verwendungszweck erkannt, ohne Rückgabe-Code. Rein, für Vorschlag und Rückgabe.
 */
export function isReturnFeeLine(raw: { amountCents: number; returnCode: string | null; purpose: string | null }): boolean {
  if (raw.amountCents >= 0 || raw.returnCode) return false;
  const purpose = fold(raw.purpose);
  return /r(ue|u)ck-?lastschrift/.test(purpose) && /(entgelt|gebuehr|spesen|preis)/.test(purpose);
}

/**
 * U3 (Plan N3): das Entgelt einer Rückgabe, das als eigene, festgeschriebene Buchung kam — berechnet, nie gespeichert.
 * Nur, wenn an diesem Tag auf diesem Konto genau eine Rückgabe und genau eine solche Entgeltzeile gebucht sind; bei
 * zweien wird nichts geraten, das Entgelt bleibt allein eine eigene Buchung. Ohne Rechteprüfung.
 */
export function separateReturnFeeCentsInternal(db: DbOrTx, row: Pick<FinanceDirectDebitReturnRow, 'rawTransactionId'>): number {
  const raw = db.select().from(financeRawTransactions).where(eq(financeRawTransactions.id, row.rawTransactionId)).get();
  if (!raw) return 0;
  const sameDay = and(eq(financeRawTransactions.accountId, raw.accountId), eq(financeRawTransactions.bookingDate, raw.bookingDate));
  const returns = db.select({ id: financeDirectDebitReturns.id }).from(financeDirectDebitReturns).innerJoin(financeRawTransactions, eq(financeRawTransactions.id, financeDirectDebitReturns.rawTransactionId)).where(sameDay).all();
  if (returns.length !== 1) return 0;
  const fees = db
    .select({ raw: financeRawTransactions })
    .from(financeRawTransactions)
    .innerJoin(financeMoneyLines, and(eq(financeMoneyLines.rawTransactionId, financeRawTransactions.id), isNull(financeMoneyLines.rawReleasedAt)))
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .where(and(sameDay, eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId)))
    .all()
    .filter((r) => isReturnFeeLine(r.raw));
  return fees.length === 1 ? -fees[0]!.raw.amountCents : 0;
}
