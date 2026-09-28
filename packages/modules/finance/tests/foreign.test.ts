import { unwrap } from '@kompass/core';
import { contacts, createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approvePartnerPayment } from '../src/allocation/approvals';
import { foreignActivityInternal } from '../src/allocation/foreign';
import { savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { bookEntry } from '../src/ledger/finalize';
import { insertDocument, ledgerFixture } from './helpers';

describe('foreignActivityInternal (F7 Task 5, Annahme 14)', () => {
  it("does not count a partner payment's lines twice — they show only in the partner-payments group", async () => {
    const f = await ledgerFixture();
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Auslandsbericht e.V.' }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'foreignBody', usualBasis: 'transfer58' }));
    const agreement = insertDocument(f, { subject: 'Vereinbarung', typeKey: 'voucher-invoice' });
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', agreementDocumentId: agreement, retroactive: false, positions: [{ kind: 'money', amountCents: 6000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-10', text: `Förderung ${approved.number}`, moneyLines: [{ accountId: f.bank.id, amountCents: -6000, settlements: [{ openItemId: approved.openItemId!, amountCents: 6000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -6000, abroad: true }] }));

    const view = foreignActivityInternal(f.deps.db, { from: '2026-01-01', to: '2026-12-31' }, 'DE');
    expect(view.partnerPayments).toEqual([{ paymentId: approved.id, number: approved.number, partnerName: 'Auslandsbericht e.V.', basis: 'transfer58', totalCents: 6000, approvedAt: approved.approvedAt }]);
    expect(view.otherAbroadLines).toEqual([]);
  });

  it('lists other lines with abroad, and other lines to a contact abroad, without either overlapping', async () => {
    const f = await ledgerFixture();
    const abroadEntry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Spende Ausland', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, abroad: true }] }));
    f.deps.db.update(contacts).set({ country: 'AT' }).where(eq(contacts.id, f.donor.id)).run();
    const contactEntry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-02', text: 'Zahlung', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500, contactId: f.donor.id }] }));

    const view = foreignActivityInternal(f.deps.db, { from: '2026-01-01', to: '2026-12-31' }, 'DE');
    expect(view.otherAbroadLines.map((l) => l.entryId)).toEqual([abroadEntry.id]);
    expect(view.otherForeignContactLines.map((l) => l.entryId)).toEqual([contactEntry.id]);
  });
});
