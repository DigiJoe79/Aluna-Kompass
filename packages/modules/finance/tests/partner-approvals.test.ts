import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approvePartnerPayment, listApprovals } from '../src/allocation/approvals';
import { partnerPaidLineContactLock, partnerPaidLineEntryLock, partnerPayingEntryLock } from '../src/allocation/locks';
import { rejectPartnerPayment, savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { listEntries } from '../src/ledger/entries';
import { previewPeriodClose } from '../src/ledger/period';
import { savePartnerNotice, savePartnerProfile } from '../src/allocation/partners';
import { expenseFixture, expenseSubmitted } from './expense-fixture';
import { documentationOf } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { suggestForTransaction } from '../src/import/suggestions';
import { financeAllocationLines, financePartnerPayments } from '../src/schema';
import { insertDocument, insertRaw, insertRun, ledgerFixture } from './helpers';

async function orgPartner(f: Awaited<ReturnType<typeof ledgerFixture>>, name: string, status: 'taxExemptBody' | 'publicBody' | 'foreignBody' = 'publicBody', extra: Record<string, unknown> = {}) {
  const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name }));
  return { org, partner: unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status, ...extra })) };
}

describe('listApprovals — polymorphe Warteschlange (F7 Task 4)', () => {
  it('queues expense claims and partner payments together, oldest first, before paging', async () => {
    const f = await expenseFixture();
    const claim = await expenseSubmitted(f);
    f.deps.clock.set('2026-09-05T09:00:00.000Z');
    const { partner } = await orgPartner(f, 'Warteschlangenpartner e.V.');
    // Von der zweiten Person angelegt, damit der Betrachter (`f.ctx`) sie in seiner Warteschlange sieht.
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.secondPerson, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: false, positions: [{ kind: 'money', amountCents: 2000, categoryId: f.programCosts.id }] }));
    const payment = unwrap(await submitPartnerPayment(f.deps, f.secondPerson, { id: draft.id, expectedVersion: draft.version }));

    const queue = unwrap(await listApprovals(f.deps, f.ctx, {}));
    expect(queue.total).toBe(2);
    expect(queue.items.map((i) => i.kind)).toEqual(['expenseClaim', 'partnerPayment']);
    expect(queue.items[0]).toMatchObject({ kind: 'expenseClaim', claimId: claim.id });
    expect(queue.items[1]).toMatchObject({ kind: 'partnerPayment', paymentId: payment.id, partnerName: 'Warteschlangenpartner e.V.', totalCents: 2000 });

    const page = unwrap(await listApprovals(f.deps, f.ctx, { limit: 1, offset: 1 }));
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ kind: 'partnerPayment', paymentId: payment.id });
  });

  it("does not list the viewer's own partner payment", async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Eigener Partner e.V.');
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(unwrap(await listApprovals(f.deps, f.ctx, {})).total).toBe(0);
  });
});

describe('approvePartnerPayment (F7 Task 4, Annahme 7)', () => {
  it('books the open item with the number as payment reference, and abroad from a foreign partner — the resulting suggestion carries it through', async () => {
    const f = await ledgerFixture();
    const { org, partner } = await orgPartner(f, 'Auslandspartner e.V.', 'foreignBody', { usualBasis: 'transfer58' });
    const agreement = insertDocument(f, { subject: 'Vereinbarung', typeKey: 'voucher-invoice' });
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung im Ausland', agreementDocumentId: agreement, retroactive: false, positions: [{ kind: 'money', amountCents: 7500, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const approver = f.secondPerson;
    const approved = unwrap(await approvePartnerPayment(f.deps, approver, { id: submitted.id, expectedVersion: submitted.version }));
    expect(approved).toMatchObject({ state: 'approved', number: expect.stringMatching(/^PZ-2026-\d{3}$/) });
    expect(approved.openItemId).not.toBeNull();

    const run = insertRun(f, f.bank.id);
    const raw = insertRaw(f, run, { accountId: f.bank.id, amountCents: -7500, purpose: `Förderung ${approved.number}`, name: org.name ?? undefined });
    const suggestion = unwrap(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId: raw }));
    expect(suggestion.draft!.allocationLines).toContainEqual(expect.objectContaining({ abroad: true }));
    void org;
  });

  it('creates no open item for a retroactive approval, and refuses when the creator tries to approve their own payment', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Rückwirkend e.V.');
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -3000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -3000, contactId: partner.contactId }] }));
    const lineId = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: true, positions: [], paidLineIds: [lineId] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const own = await approvePartnerPayment(f.deps, f.ctx, { id: submitted.id, expectedVersion: submitted.version });
    expect(own.ok).toBe(false);
    expect(JSON.stringify(own)).toContain('partnerPaymentOwnCreator');
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    expect(approved.openItemId).toBeNull();

    // Review Focus 2: eine zweite, gleichzeitige Freigabe trifft auf keinen Posten mehr.
    const again = await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version });
    expect(again.ok).toBe(false);
    expect(JSON.stringify(again)).toContain('partnerPaymentNotSubmitted');
  });

  it('requires a reason once the notice of a tax-exempt partner has expired between submission and approval (Review Focus 5)', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2024-06-01T09:00:00.000Z'); // vor Ablauf des Bescheids (2025-01-01) — am Einreichetag gültig.
    const { partner } = await orgPartner(f, 'Bescheidpartner e.V.', 'taxExemptBody');
    const docId = insertDocument(f, { subject: 'Bescheid', typeKey: 'voucher-invoice' });
    unwrap(await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: '2020-01-01', documentId: docId, receivedOn: '2020-01-10' }));
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(submitted.noticeReason).toBeNull();

    // Der Bescheid trägt nur fünf Jahre (Freistellungsbescheid) — bis zur Freigabe ist er abgelaufen.
    f.deps.clock.set('2026-03-01T09:00:00.000Z');
    const denied = await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version });
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied)).toContain('partnerNoticeReasonRequired');
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version, noticeReason: 'Bescheid inzwischen abgelaufen, neuer Bescheid angefordert' }));
    expect(approved.state).toBe('approved');
  });

  it('N6: names every missing reason at once — expired notice and overdue proofs of an earlier payment', async () => {
    const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
    f.deps.clock.set('2024-06-01T09:00:00.000Z');
    const { partner } = await orgPartner(f, 'Doppelpartner e.V.', 'taxExemptBody');
    const docId = insertDocument(f, { subject: 'Bescheid', typeKey: 'voucher-invoice' });
    unwrap(await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: '2020-01-01', documentId: docId, receivedOn: '2020-01-10' }));
    const submit = async () => {
      const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
      return unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    };
    const earlier = await submit();
    const later = await submit();
    const approvedEarlier = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: earlier.id, expectedVersion: earlier.version }));
    // Task 6c: überfällig erst ab Zahlung + Frist — die erste Zahlung ist gezahlt.
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2024-06-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -1000, settlements: [{ openItemId: approvedEarlier.openItemId!, amountCents: 1000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1000 }] }));

    f.deps.clock.set('2026-03-01T09:00:00.000Z'); // Bescheid abgelaufen, Nachweise der ersten Zahlung längst überfällig.
    const denied = await approvePartnerPayment(f.deps, f.secondPerson, { id: later.id, expectedVersion: later.version });
    expect(denied).toMatchObject({ ok: false, error: { type: 'conflict', code: 'partnerNoticeReasonRequired', also: [{ code: 'partnerOverdueReasonRequired', messageKey: 'finance.errors.partnerOverdueReasonRequired' }] } });
  });

  it('marks the paying entry as documented on its origin, once it settles the resulting open item', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Belegpartner e.V.');
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 4000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    const paying = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-10', text: `Förderung ${approved.number}`, moneyLines: [{ accountId: f.bank.id, amountCents: -4000, settlements: [{ openItemId: approved.openItemId!, amountCents: 4000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -4000 }] }));
    expect(documentationOf(f.deps.db, paying.id, { statementSufficesBelowCents: 0 })).toMatchObject({ state: 'onOrigin' });
  });
});

describe('Befund X — nachträgliche Zahlung an Partner belegt die bezahlte Buchung', () => {
  async function retroactiveSetup() {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Nachträglich e.V.');
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -30000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -30000, contactId: partner.contactId }] }));
    const lineId = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: true, positions: [], paidLineIds: [lineId] }));
    return { f, entry, draft };
  }
  const docOf = (f: Awaited<ReturnType<typeof ledgerFixture>>, id: string) => documentationOf(f.deps.db, id, { statementSufficesBelowCents: 0 });

  it('an approved retroactive payment documents the entry on its origin — not in "without voucher", not in the closing preview', async () => {
    const { f, entry, draft } = await retroactiveSetup();
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    expect(approved.acknowledgedAt).toBeNull(); // belegt ab der Freigabe, nicht erst ab dem Anerkennen.
    expect(docOf(f, entry.id)).toMatchObject({ state: 'onOrigin', origin: { entity: 'financePartnerPayment', id: approved.id } });
    const without = unwrap(await listEntries(f.deps, f.ctx, { state: 'final', withoutVoucher: true }));
    expect(without.entries.map((e) => e.id)).not.toContain(entry.id);
    const preview = unwrap(await previewPeriodClose(f.deps, f.ctx, { id: f.year.id }));
    expect(preview.undocumented.map((u) => u.entryId)).not.toContain(entry.id);
  });

  it('a draft, submitted or rejected retroactive payment leaves the entry missing', async () => {
    const { f, entry, draft } = await retroactiveSetup();
    expect(docOf(f, entry.id).state).toBe('missing');
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(docOf(f, entry.id).state).toBe('missing');
    unwrap(await rejectPartnerPayment(f.deps, f.secondPerson, { id: submitted.id, note: 'nein' }));
    expect(docOf(f, entry.id).state).toBe('missing');
  });
});

describe('allocation/locks.ts — Sperren einer Zahlung an Partner (F7 Task 4)', () => {
  it('locks storno and contact correction of the entry that holds a paid line of a non-draft payment', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Sperrpartner e.V.');
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -2500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -2500, contactId: partner.contactId }] }));
    expect(partnerPaidLineEntryLock(f.deps.db, entry.id)).toBeNull();
    const lineId = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: true, positions: [], paidLineIds: [lineId] }));
    expect(partnerPaidLineEntryLock(f.deps.db, entry.id)).toBeNull(); // ein Entwurf sperrt noch nichts.
    unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(partnerPaidLineEntryLock(f.deps.db, entry.id)).toMatchObject({ scope: 'entry', code: expect.stringMatching(/^entryLockedBy(Pending)?PartnerPayment$/), params: { payment: expect.any(String) } });
    expect(partnerPaidLineContactLock(f.deps.db, entry.id)).toMatchObject({ scope: 'contact', code: expect.stringMatching(/^contactLockedBy(Pending)?PartnerPayment$/), params: { payment: expect.any(String) } });
  });

  it('locks the paying entry of a usual payment only once its evidence is acknowledged', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Anerkennungspartner e.V.');
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 3000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    const paying = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-10', text: 'Zahlung', moneyLines: [{ accountId: f.bank.id, amountCents: -3000, settlements: [{ openItemId: approved.openItemId!, amountCents: 3000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -3000 }] }));
    expect(partnerPayingEntryLock(f.deps.db, paying.id)).toBeNull();
    f.deps.db.update(financePartnerPayments).set({ acknowledgedAt: '2026-04-01T09:00:00.000Z', acknowledgedByUserId: f.secondPersonId }).where(eq(financePartnerPayments.id, approved.id)).run();
    expect(partnerPayingEntryLock(f.deps.db, paying.id)).toMatchObject({ scope: 'entry', code: 'entryLockedByPartnerPayment', params: { payment: expect.stringMatching(/\S/) } });
  });
});
