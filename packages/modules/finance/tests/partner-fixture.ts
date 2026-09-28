import { newId } from '@kompass/core';
import {
  financePartnerEvidence,
  financePartnerNotices,
  financePartnerPaidLines,
  financePartnerPaymentPositions,
  financePartnerPayments,
  financePartnerProfiles,
  type FinancePartnerEvidenceRow,
  type FinancePartnerNoticeRow,
  type FinancePartnerPaidLineRow,
  type FinancePartnerPaymentPositionRow,
  type FinancePartnerPaymentRow,
  type FinancePartnerProfileRow,
} from '../src/schema';

/**
 * Direkte Einfüge-Helfer für Partner, Zahlungen an Partner und Nachweise —
 * wie `insertClaim`/`insertPosition` in `holds.test.ts` für Auslagen. Kein
 * Dienst dahinter: Diese Helfer legen nur Zeilen an, um Trigger, Halter und
 * Verweise unabhängig von den noch fehlenden Diensten (Task 2/3) zu prüfen.
 */
const T = '2026-03-02T10:00:00.000Z';

export function insertPartner(db: { insert: Function }, o: Partial<typeof financePartnerProfiles.$inferInsert> & { contactId: string; status?: FinancePartnerProfileRow['status'] }): string {
  const id = o.id ?? newId();
  (db as any)
    .insert(financePartnerProfiles)
    .values({ id, status: 'taxExemptBody', usualBasis: 'transfer58', usualProofMonths: 3, isActive: true, createdAt: T, createdByUserId: 'U1', updatedAt: T, ...o })
    .run();
  return id;
}

export function insertPartnerNotice(db: { insert: Function }, partnerId: string, o: Partial<typeof financePartnerNotices.$inferInsert> = {}): string {
  const id = o.id ?? newId();
  (db as any)
    .insert(financePartnerNotices)
    .values({ id, partnerId, kind: 'exemptionNotice', noticeDate: '2025-01-01', receivedOn: '2025-01-10', documentId: 'DOC-NOTICE', createdAt: T, createdByUserId: 'U1', updatedAt: T, ...o })
    .run();
  return id;
}

export function insertPartnerPayment(db: { insert: Function }, partnerId: string, o: Partial<typeof financePartnerPayments.$inferInsert> = {}): string {
  const id = o.id ?? newId();
  (db as any)
    .insert(financePartnerPayments)
    .values({ id, partnerId, basis: 'transfer58', basisOverridden: false, purposeText: 'Förderung', state: 'draft', retroactive: false, createdByUserId: 'U1', createdAt: T, updatedAt: T, ...o })
    .run();
  return id;
}

export function insertPartnerPaymentPosition(db: { insert: Function }, paymentId: string, o: Partial<typeof financePartnerPaymentPositions.$inferInsert> = {}): string {
  const id = o.id ?? newId();
  (db as any).insert(financePartnerPaymentPositions).values({ id, paymentId, sortOrder: 0, kind: 'money', amountCents: 5000, ...o }).run();
  return id;
}

export function insertPartnerPaidLine(db: { insert: Function }, paymentId: string, paidLineId: string, o: Partial<typeof financePartnerPaidLines.$inferInsert> = {}): string {
  const id = o.id ?? newId();
  (db as any).insert(financePartnerPaidLines).values({ id, paymentId, paidLineId, createdAt: T, ...o }).run();
  return id;
}

export function insertPartnerEvidence(db: { insert: Function }, paymentId: string, o: Partial<typeof financePartnerEvidence.$inferInsert> = {}): string {
  const id = o.id ?? newId();
  (db as any)
    .insert(financePartnerEvidence)
    .values({ id, paymentId, kind: 'paymentProof', documentId: 'DOC-EVIDENCE', foreignLanguage: false, addedByUserId: 'U1', addedAt: T, ...o })
    .run();
  return id;
}

export type { FinancePartnerPaymentRow, FinancePartnerProfileRow, FinancePartnerNoticeRow, FinancePartnerPaymentPositionRow, FinancePartnerPaidLineRow, FinancePartnerEvidenceRow };

/**
 * Task 6c (Frist ab Zahlung): eine freigegebene, nachträgliche und damit
 * bezahlte Zahlung an Partner — die Nachweisfrist läuft ab `entryDate` der
 * gebuchten Zeile. Die Zeile wird festgeschrieben gebucht; die Zahlung durchläuft
 * Entwurf → eingereicht → freigegeben, wie die Trigger es verlangen.
 */
export async function insertPaidPartnerPayment(
  f: { deps: { db: any }; ctx: any; bank: { id: string }; programCosts: { id: string } },
  partnerId: string,
  contactId: string,
  entryDate: string,
  o: Partial<typeof financePartnerPayments.$inferInsert> = {},
): Promise<string> {
  const { bookEntry } = await import('../src/ledger/finalize');
  const { financeAllocationLines } = await import('../src/schema');
  const { eq } = await import('drizzle-orm');
  const { unwrap } = await import('@kompass/core');
  const entry = unwrap(await bookEntry(f.deps as never, f.ctx, { entryDate, text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId }] }));
  const lineId = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
  const id = insertPartnerPayment(f.deps.db, partnerId, { retroactive: true, ...o, state: 'draft' });
  insertPartnerPaidLine(f.deps.db, id, lineId);
  f.deps.db.update(financePartnerPayments).set({ state: 'submitted', submittedAt: T }).where(eq(financePartnerPayments.id, id)).run();
  f.deps.db.update(financePartnerPayments).set({ state: 'approved', approvedAt: T, approvedByUserId: 'U2', number: o.number ?? `PZ-${id.slice(-6)}` }).where(eq(financePartnerPayments.id, id)).run();
  return id;
}
