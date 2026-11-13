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

    const view = foreignActivityInternal(f.deps.db, { from: '2026-01-01', to: '2026-12-31' }, 'DE', 'Europe/Berlin');
    expect(view.partnerPayments).toEqual([{ paymentId: approved.id, number: approved.number, partnerName: 'Auslandsbericht e.V.', basis: 'transfer58', totalCents: 6000, approvedAt: approved.approvedAt }]);
    expect(view.otherAbroadLines).toEqual([]);
  });

  it('F-B3 (0.4.5): an approval on 01.01. at 00:30 Berlin time belongs to the new year, not the old one', async () => {
    const f = await ledgerFixture();
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Auslandsbericht e.V.' }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'foreignBody', usualBasis: 'transfer58' }));
    const agreement = insertDocument(f, { subject: 'Vereinbarung', typeKey: 'voucher-invoice' });
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', agreementDocumentId: agreement, retroactive: false, positions: [{ kind: 'money', amountCents: 6000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    f.deps.clock.set('2025-12-31T23:30:00.000Z');
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    expect(approved.approvedAt).toBe('2025-12-31T23:30:00.000Z');
    expect(foreignActivityInternal(f.deps.db, { from: '2025-01-01', to: '2025-12-31' }, 'DE', 'Europe/Berlin').partnerPayments).toEqual([]);
    expect(foreignActivityInternal(f.deps.db, { from: '2026-01-01', to: '2026-12-31' }, 'DE', 'Europe/Berlin').partnerPayments.map((p) => p.paymentId)).toEqual([approved.id]);
  });

  it('lists other lines with abroad, and other lines to a contact abroad, without either overlapping', async () => {
    const f = await ledgerFixture();
    const abroadEntry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Hilfe Ausland', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, abroad: true }] }));
    f.deps.db.update(contacts).set({ country: 'AT' }).where(eq(contacts.id, f.donor.id)).run();
    const contactEntry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-02', text: 'Zahlung', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500, contactId: f.donor.id }] }));

    const view = foreignActivityInternal(f.deps.db, { from: '2026-01-01', to: '2026-12-31' }, 'DE', 'Europe/Berlin');
    expect(view.otherAbroadLines.map((l) => l.entryId)).toEqual([abroadEntry.id]);
    expect(view.otherForeignContactLines.map((l) => l.entryId)).toEqual([contactEntry.id]);
  });

  /** Befund B2 (0.5.2): Eine Einnahme ist nicht „im Ausland verwendet“, auch mit dem Kennzeichen; ein Storno einer Ausgabe zählt mit. */
  it('lists only expense lines as used abroad; the reversal of an expense balances it', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Spende Ausland', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, abroad: true }] }));
    const expense = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-02', text: 'Hilfe Ausland', moneyLines: [{ accountId: f.bank.id, amountCents: -3000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -3000, abroad: true }] }));
    const reversal = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-03', text: 'Hilfe Ausland, Storno', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: 3000, abroad: true }] }));

    const view = foreignActivityInternal(f.deps.db, { from: '2026-01-01', to: '2026-12-31' }, 'DE', 'Europe/Berlin');
    expect(view.otherAbroadLines.map((l) => [l.entryId, l.amountCents])).toEqual([[expense.id, -3000], [reversal.id, 3000]]);
  });

  /** Befund B2 (0.5.2): Eine Einnahme mit dem Kennzeichen von einem Kontakt im Ausland fällt nicht aus beiden Gruppen. */
  it('keeps an income line flagged abroad from a contact abroad in the contact group', async () => {
    const f = await ledgerFixture();
    f.deps.db.update(contacts).set({ country: 'AT' }).where(eq(contacts.id, f.donor.id)).run();
    const income = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Spende aus Österreich', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, abroad: true, contactId: f.donor.id }] }));

    const view = foreignActivityInternal(f.deps.db, { from: '2026-01-01', to: '2026-12-31' }, 'DE', 'Europe/Berlin');
    expect(view.otherAbroadLines).toEqual([]);
    expect(view.otherForeignContactLines.map((l) => l.entryId)).toEqual([income.id]);
  });
});
