import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { financeAllocationLines, financePartnerEvidence, financePartnerPaidLines, financePartnerPaymentPositions, financePartnerPayments } from '../src/schema';
import { ledgerFixture, setupFinance } from './helpers';
import { insertPartner, insertPartnerEvidence, insertPartnerPaidLine, insertPartnerPayment, insertPartnerPaymentPosition } from './partner-fixture';

/** Eine festgeschriebene, an den Partner gezahlte Zeile — wie sie `paidLines` im Entwurf wählen würde. */
async function paidLine(f: Awaited<ReturnType<typeof ledgerFixture>>, contactId: string) {
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId }] }));
  return f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
}

/**
 * Trigger der sechs neuen Tabellen (F7 Task 1, Migration 0030): Ein Vorgang
 * ist ab dem Einreichen Rechenschaft, seine Positionen und Paid-Lines
 * unveränderlich, ein Nachweis nach dem Anerkennen nur noch als Grabstein.
 * Reiner Tabellentest, ohne die Dienste aus Task 2/3.
 */
describe('finance partner tables — triggers (F7 Task 1)', () => {
  it('deletes a draft payment, but not once it left the draft', () => {
    const { deps } = setupFinance();
    const partnerId = insertPartner(deps.db, { contactId: 'CONTACT-1' });
    const draftId = insertPartnerPayment(deps.db, partnerId);
    expect(() => deps.db.delete(financePartnerPayments).where(eq(financePartnerPayments.id, draftId)).run()).not.toThrow();

    const submittedId = insertPartnerPayment(deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z' });
    expect(() => deps.db.delete(financePartnerPayments).where(eq(financePartnerPayments.id, submittedId)).run()).toThrow(/permanent/);
  });

  it('lässt die Nachweisfrist in Monaten nur im Entwurf ändern (Migration 0037)', () => {
    const { deps } = setupFinance();
    const partnerId = insertPartner(deps.db, { contactId: 'CONTACT-1' });
    const draftId = insertPartnerPayment(deps.db, partnerId);
    expect(() => deps.db.update(financePartnerPayments).set({ proofMonths: 4 }).where(eq(financePartnerPayments.id, draftId)).run()).not.toThrow();
    const submittedId = insertPartnerPayment(deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z', proofMonths: 3 });
    expect(() => deps.db.update(financePartnerPayments).set({ proofMonths: 6 }).where(eq(financePartnerPayments.id, submittedId)).run()).toThrow(/permanent/);
  });

  it('Q Rest (Migration 0040): die Freigabe ergänzt eine fehlende Begründung für den Zweck im Minus — nie eine vorhandene, danach nichts mehr', () => {
    const { deps } = setupFinance();
    const partnerId = insertPartner(deps.db, { contactId: 'CONTACT-1' });
    const set = (id: string, purposeNegativeReason: string | null) => () => deps.db.update(financePartnerPayments).set({ purposeNegativeReason }).where(eq(financePartnerPayments.id, id)).run();
    const open = insertPartnerPayment(deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z' });
    expect(set(open, 'bei der Freigabe ergänzt')).not.toThrow();
    expect(set(open, 'anders')).toThrow(/permanent/);
    const given = insertPartnerPayment(deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z', purposeNegativeReason: 'beim Einreichen' });
    expect(set(given, null)).toThrow(/permanent/);
    const approved = insertPartnerPayment(deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z' });
    deps.db.update(financePartnerPayments).set({ state: 'approved', number: 'PZ-2026-009', approvedAt: '2026-03-03T09:00:00.000Z', approvedByUserId: 'U2' }).where(eq(financePartnerPayments.id, approved)).run();
    expect(set(approved, 'zu spät')).toThrow(/permanent/);
  });

  it('moves a draft only to submitted, never straight to approved or rejected', () => {
    const { deps } = setupFinance();
    const partnerId = insertPartner(deps.db, { contactId: 'CONTACT-1' });
    const id = insertPartnerPayment(deps.db, partnerId);
    expect(() => deps.db.update(financePartnerPayments).set({ state: 'approved' }).where(eq(financePartnerPayments.id, id)).run()).toThrow();
    expect(() => deps.db.update(financePartnerPayments).set({ state: 'submitted' }).where(eq(financePartnerPayments.id, id)).run()).not.toThrow();
  });

  it('lets state leave submitted exactly once — a second approval attempt on an already-decided row is refused', () => {
    const { deps } = setupFinance();
    const partnerId = insertPartner(deps.db, { contactId: 'CONTACT-1' });
    const id = insertPartnerPayment(deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z' });
    expect(() => deps.db.update(financePartnerPayments).set({ state: 'approved', number: 'PZ-2026-001', approvedAt: '2026-03-03T09:00:00.000Z', approvedByUserId: 'U2' }).where(eq(financePartnerPayments.id, id)).run()).not.toThrow();
    expect(() => deps.db.update(financePartnerPayments).set({ state: 'rejected', rejectedAt: '2026-03-04T09:00:00.000Z', rejectedByUserId: 'U3', rejectNote: 'zu spät' }).where(eq(financePartnerPayments.id, id)).run()).toThrow(/permanent/);
  });

  it('rejects a submitted payment, and a rejected payment stays put — no further state change', () => {
    const { deps } = setupFinance();
    const partnerId = insertPartner(deps.db, { contactId: 'CONTACT-1' });
    const id = insertPartnerPayment(deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z' });
    expect(() => deps.db.update(financePartnerPayments).set({ state: 'rejected', rejectedAt: '2026-03-04T09:00:00.000Z', rejectedByUserId: 'U3', rejectNote: 'zu spät' }).where(eq(financePartnerPayments.id, id)).run()).not.toThrow();
    expect(() => deps.db.update(financePartnerPayments).set({ purposeText: 'anders' }).where(eq(financePartnerPayments.id, id)).run()).toThrow(/permanent/);
  });

  it('sets the acknowledgement only once, and only once the payment is approved', () => {
    const { deps } = setupFinance();
    const partnerId = insertPartner(deps.db, { contactId: 'CONTACT-1' });
    const submitted = insertPartnerPayment(deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z' });
    expect(() => deps.db.update(financePartnerPayments).set({ acknowledgedAt: '2026-03-05T09:00:00.000Z', acknowledgedByUserId: 'U2' }).where(eq(financePartnerPayments.id, submitted)).run()).toThrow(/permanent/);

    const approved = insertPartnerPayment(deps.db, partnerId, { state: 'approved', submittedAt: '2026-03-02T10:00:00.000Z', approvedAt: '2026-03-03T09:00:00.000Z', approvedByUserId: 'U2', number: 'PZ-2026-002' });
    expect(() => deps.db.update(financePartnerPayments).set({ acknowledgedAt: '2026-03-05T09:00:00.000Z', acknowledgedByUserId: 'U2', acknowledgedChannel: 'ui' }).where(eq(financePartnerPayments.id, approved)).run()).not.toThrow();
    expect(() => deps.db.update(financePartnerPayments).set({ acknowledgedByUserId: 'U3' }).where(eq(financePartnerPayments.id, approved)).run()).toThrow(/permanent/);
  });

  it('lets positions and paid lines be inserted and deleted only while the payment is a draft', async () => {
    const f = await ledgerFixture();
    const partnerId = insertPartner(f.deps.db, { contactId: f.donor.id });
    const draftId = insertPartnerPayment(f.deps.db, partnerId);
    const positionId = insertPartnerPaymentPosition(f.deps.db, draftId);
    expect(() => f.deps.db.delete(financePartnerPaymentPositions).where(eq(financePartnerPaymentPositions.id, positionId)).run()).not.toThrow();

    const submittedId = insertPartnerPayment(f.deps.db, partnerId, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z' });
    expect(() => insertPartnerPaymentPosition(f.deps.db, submittedId)).toThrow(/permanent/);
    const line = await paidLine(f, f.donor.id);
    const paidLineId = insertPartnerPaidLine(f.deps.db, draftId, line);
    expect(() => f.deps.db.delete(financePartnerPaidLines).where(eq(financePartnerPaidLines.id, paidLineId)).run()).not.toThrow();
    const line2 = await paidLine(f, f.donor.id);
    expect(() => insertPartnerPaidLine(f.deps.db, submittedId, line2)).toThrow(/permanent/);
  });

  it('refuses a paid line that is already assigned to another payment (UNIQUE)', async () => {
    const f = await ledgerFixture();
    const partnerId = insertPartner(f.deps.db, { contactId: f.donor.id });
    const paymentA = insertPartnerPayment(f.deps.db, partnerId);
    const paymentB = insertPartnerPayment(f.deps.db, partnerId);
    const line = await paidLine(f, f.donor.id);
    insertPartnerPaidLine(f.deps.db, paymentA, line);
    expect(() => insertPartnerPaidLine(f.deps.db, paymentB, line)).toThrow();
  });

  it('lets evidence be edited and deleted before the acknowledgement; after it, only the document id may be cleared', () => {
    const { deps } = setupFinance();
    const partnerId = insertPartner(deps.db, { contactId: 'CONTACT-1' });
    const approved = insertPartnerPayment(deps.db, partnerId, { state: 'approved', submittedAt: '2026-03-02T10:00:00.000Z', approvedAt: '2026-03-03T09:00:00.000Z', approvedByUserId: 'U2', number: 'PZ-2026-003' });
    const evidenceId = insertPartnerEvidence(deps.db, approved);
    expect(() => deps.db.update(financePartnerEvidence).set({ coveredCents: 1000 }).where(eq(financePartnerEvidence.id, evidenceId)).run()).not.toThrow();
    expect(() => deps.db.delete(financePartnerEvidence).where(eq(financePartnerEvidence.id, evidenceId)).run()).not.toThrow();

    const evidenceId2 = insertPartnerEvidence(deps.db, approved);
    deps.db.update(financePartnerPayments).set({ acknowledgedAt: '2026-03-06T09:00:00.000Z', acknowledgedByUserId: 'U2' }).where(eq(financePartnerPayments.id, approved)).run();
    expect(() => deps.db.update(financePartnerEvidence).set({ coveredCents: 2000 }).where(eq(financePartnerEvidence.id, evidenceId2)).run()).toThrow(/permanent/);
    expect(() => deps.db.update(financePartnerEvidence).set({ documentId: null }).where(eq(financePartnerEvidence.id, evidenceId2)).run()).not.toThrow();
    expect(() => deps.db.delete(financePartnerEvidence).where(eq(financePartnerEvidence.id, evidenceId2)).run()).toThrow(/permanent/);
  });
});
