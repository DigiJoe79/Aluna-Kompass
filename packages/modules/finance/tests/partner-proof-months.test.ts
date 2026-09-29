import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approvePartnerPayment } from '../src/allocation/approvals';
import { listEvidence } from '../src/allocation/evidence';
import { proofDueDate } from '../src/allocation/evidence-rules';
import { getPartnerPayment, partnerProofDeadlinesInternal, savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerNotice, savePartnerProfile } from '../src/allocation/partners';
import { bookEntry } from '../src/ledger/finalize';
import { financeAllocationLines } from '../src/schema';
import { insertDocument, ledgerFixture } from './helpers';
import { insertPaidPartnerPayment, insertPartnerEvidence, insertPartnerPayment } from './partner-fixture';

async function orgPartner(f: Awaited<ReturnType<typeof ledgerFixture>>, name: string, status: 'taxExemptBody' | 'publicBody' | 'foreignBody' = 'publicBody', extra: Record<string, unknown> = {}) {
  const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name }));
  return { org, partner: unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status, ...extra })) };
}

describe('Nachweisfrist in Monaten (Design-Nachtrag Phase 4, Entscheidung 2)', () => {
  it('der Partner führt die übliche Frist in Monaten, Vorgabe 3', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Fristpartner e.V.');
    expect(partner.usualProofMonths).toBe(3);
    const { partner: six } = await orgPartner(f, 'Sechsmonatspartner e.V.', 'publicBody', { usualProofMonths: 6 });
    expect(six.usualProofMonths).toBe(6);
    expect(await savePartnerProfile(f.deps, f.ctx, { contactId: six.contactId, id: six.id, status: 'publicBody', usualProofMonths: 0 })).toMatchObject({ ok: false });
  });

  it('der Entwurf zeigt die Frist aus der üblichen Frist, übersteuert sie je Zahlung, und die Freigabe übernimmt sie', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Fristzahlung e.V.');
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    expect(draft).toMatchObject({ proofMonths: null, effectiveProofMonths: 3 });
    const changed = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: false, proofMonths: 5, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    expect(changed).toMatchObject({ proofMonths: 5, effectiveProofMonths: 5 });
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: changed.version }));
    // Ab dem Einreichen gilt die Frist fest — eine spätere Änderung am Partner wirkt nicht mehr.
    unwrap(await savePartnerProfile(f.deps, f.ctx, { id: partner.id, contactId: partner.contactId, status: 'publicBody', usualProofMonths: 1 }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    // Joe 28.09. (Task 6c): die Frist läuft ab dem Zahlungstag — vor der Zahlung kein Datum, kein „überfällig“.
    expect(approved.proofDueOn).toBeNull();
    expect(partnerProofDeadlinesInternal(f.deps.db, '2099-01-01', 0).filter((d) => d.paymentId === approved.id)).toEqual([]);
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-10', text: `Förderung ${approved.number}`, moneyLines: [{ accountId: f.bank.id, amountCents: -1000, settlements: [{ openItemId: approved.openItemId!, amountCents: 1000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1000 }] }));
    const paid = unwrap(await getPartnerPayment(f.deps, f.ctx, { id: approved.id }));
    expect(paid).toMatchObject({ activeStep: 'paid', paidOn: '2026-04-10', proofDueOn: proofDueDate('2026-04-10', 5) });
    expect(partnerProofDeadlinesInternal(f.deps.db, '2026-09-11', 0).find((d) => d.paymentId === approved.id)).toMatchObject({ proofDueOn: '2026-09-10', overdue: true });
    expect(partnerProofDeadlinesInternal(f.deps.db, '2026-09-10', 0).find((d) => d.paymentId === approved.id)).toMatchObject({ overdue: false });
  });

  it('bei nachträglicher Freigabe zählt die Frist ab der ältesten bezahlten Zeile, in Monaten', async () => {
    const f = await ledgerFixture();
    const { org, partner } = await orgPartner(f, 'Nachträglich e.V.', 'publicBody', { usualProofMonths: 2 });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId: org.id }], reason: 'Vorschuss aus freien Mitteln (Befund Q)' }));
    const line = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [line] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(submitted.proofMonths).toBe(2);
    // Frist ab Zahlung (Task 6c): nachträglich gilt die Zahlung mit der Freigabe als bezahlt — ab der ältesten Zeile.
    expect(submitted.proofDueOn).toBeNull();
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    expect(approved.proofDueOn).toBe('2026-05-01');
  });

  it('Befund 29: eine eingereichte nachträgliche Zahlung hat weder Zahltag noch Frist, die Freigabe setzt beides', async () => {
    const f = await ledgerFixture();
    const { org, partner } = await orgPartner(f, 'Später e.V.', 'publicBody', { usualProofMonths: 3 });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-10', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId: org.id }], reason: 'Vorschuss aus freien Mitteln (Befund Q)' }));
    const line = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [line] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(submitted).toMatchObject({ activeStep: 'submitted', paidOn: null, proofDueOn: null });
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    expect(approved).toMatchObject({ activeStep: 'paid', paidOn: '2026-02-10', proofDueOn: proofDueDate('2026-02-10', 3) });
  });
});

describe('Warnungen vorab im Entwurf (Design-Nachtrag Phase 4, Task 1)', () => {
  it('meldet einen fehlenden Bescheid schon im Entwurf, nicht erst nach dem Einreichen', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Ohne Bescheid e.V.', 'taxExemptBody');
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [] }));
    expect(draft.reasonsNeeded).toEqual({ notice: true, overdue: false, purpose: false, noticeValidUntil: null });
    const notice = insertDocument(f, { subject: 'Freistellungsbescheid', typeKey: 'voucher-invoice' });
    unwrap(await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: '2025-01-01', receivedOn: '2025-01-05', documentId: notice }));
    const read = unwrap(await getPartnerPayment(f.deps, f.ctx, { id: draft.id }));
    expect(read.reasonsNeeded).toEqual({ notice: false, overdue: false, purpose: false, noticeValidUntil: expect.any(String) });
  });

  it('meldet überfällige Nachweise einer anderen Zahlung desselben Partners vorab', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Säumig e.V.');
    await insertPaidPartnerPayment(f, partner.id, partner.contactId, '2026-01-05', { number: 'PZ-2026-901', proofMonths: 1 });
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [] }));
    expect(draft.reasonsNeeded.overdue).toBe(true);
  });
});

describe('Nachweisarten nach Spec 14.4 am Vorgang (Entscheidung 4)', () => {
  it('Einreichen legt die Vereinbarung des Entwurfs als Nachweis an, wenn die Art sie verlangt — nicht doppelt', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Auslandspartner e.V.', 'foreignBody', { usualBasis: 'transfer58' });
    const agreement = insertDocument(f, { subject: 'Vereinbarung', typeKey: 'voucher-invoice' });
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', agreementDocumentId: agreement, retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    expect(draft.requiredEvidenceKinds).toEqual(['paymentProof', 'agreement', 'recipientReceipt', 'invoice', 'report']);
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const evidence = unwrap(await listEvidence(f.deps, f.ctx, { paymentId: submitted.id }));
    expect(evidence.filter((e) => e.kind === 'agreement' && e.documentId === agreement)).toHaveLength(1);
  });

  it('liest alte Arten als neue: Foto als Bericht, Zusage als Vereinbarung', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Altbestand e.V.');
    const payment = insertPartnerPayment(f.deps.db, partner.id, { state: 'submitted', submittedAt: '2026-01-01T00:00:00.000Z' });
    insertPartnerEvidence(f.deps.db, payment, { kind: 'photo' });
    insertPartnerEvidence(f.deps.db, payment, { kind: 'assignment' });
    const kinds = unwrap(await listEvidence(f.deps, f.ctx, { paymentId: payment })).map((e) => e.kind).sort();
    expect(kinds).toEqual(['agreement', 'report']);
  });
});

describe('Schritte mit Datum (Design-Nachtrag Phase 4, Task 2)', () => {
  it('nennt den Zahlungstag: bei nachträglicher Freigabe die älteste bezahlte Zeile, sonst erst, wenn der Posten beglichen ist', async () => {
    const f = await ledgerFixture();
    const { org, partner } = await orgPartner(f, 'Schrittpartner e.V.');
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId: org.id }], reason: 'Vorschuss aus freien Mitteln (Befund Q)' }));
    const line = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [line] }));
    expect(draft.paidOn).toBeNull();
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    expect(approved).toMatchObject({ activeStep: 'paid', paidOn: '2026-03-01' });

    const { partner: other } = await orgPartner(f, 'Zweiter Schrittpartner e.V.');
    const plain = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: other.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    const plainSubmitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: plain.id, expectedVersion: plain.version }));
    const plainApproved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: plainSubmitted.id, expectedVersion: plainSubmitted.version }));
    expect(plainApproved).toMatchObject({ activeStep: 'approved', paidOn: null });
  });
});

describe('N (Prüfer Block 2): nachträgliche Zahlung übernimmt Kategorie, Zweck und Projekt der gebuchten Zeile', () => {
  it('legt je bezahlter Zeile eine Geldposition mit deren Kategorie und Zweck an', async () => {
    const f = await ledgerFixture();
    const { org, partner } = await orgPartner(f, 'Positionspartner e.V.');
    const { createPurpose } = await import('../src/ledger/purposes');
    const purpose = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck für Partner' }));
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId: org.id, purposeId: purpose.id }], reason: 'Vorschuss aus freien Mitteln (Befund Q)' }));
    const line = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [line] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(submitted.positions).toEqual([expect.objectContaining({ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id, purposeId: purpose.id })]);
  });
});

describe('O (Prüfer Block 2): der Schritt einer eingereichten Zahlung', () => {
  it('ist „submitted“ (wartet auf Freigabe), nicht mehr „draft“', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Schrittfolge e.V.');
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 100, categoryId: f.programCosts.id }] }));
    expect(draft.activeStep).toBe('draft');
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(submitted.activeStep).toBe('submitted');
  });
});

describe('P (Prüfer Block 2): Meldungen nennen die Art, wie die Oberfläche sie nennt', () => {
  it('beim Auftrag heißt die fehlende Vereinbarung „Auftrag je Vorhaben“ (Parameter agreementAgent57)', async () => {
    const f = await ledgerFixture();
    const contact = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Auftragnehmer e.V.' }));
    const agent = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: contact.id, status: 'agent' }));
    const order = insertDocument(f, { subject: 'Auftrag', typeKey: 'voucher-invoice' });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Auftrag', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId: contact.id }] }));
    const line = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: agent.id, basis: 'agent57', purposeText: 'Auftrag', agreementDocumentId: order, retroactive: true, positions: [], paidLineIds: [line] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    const { addEvidenceLink, removeEvidence, acknowledgeEvidence } = await import('../src/allocation/evidence');
    for (const e of unwrap(await listEvidence(f.deps, f.ctx, { paymentId: approved.id }))) unwrap(await removeEvidence(f.deps, f.ctx, { id: e.id }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: approved.id, kind: 'paymentProof', documentId: insertDocument(f, { subject: 'Überweisung', typeKey: 'voucher-invoice' }) }));
    const denied = await acknowledgeEvidence(f.deps, f.secondPerson, { paymentId: approved.id });
    expect(denied).toMatchObject({ ok: false, error: { code: 'evidenceKindMissing', params: { kind: 'agreementAgent57' } } });
  });
});

describe('W (Prüfer Block 2): Nachweise nennen ihre Dokumentnummer', () => {
  it('finance_partner_evidence_list liefert je Nachweis die Nummer des Dokuments', async () => {
    const f = await ledgerFixture();
    const { partner } = await orgPartner(f, 'Nummernpartner e.V.');
    const payment = insertPartnerPayment(f.deps.db, partner.id, { state: 'submitted', submittedAt: '2026-01-01T00:00:00.000Z' });
    const doc = insertDocument(f, { subject: 'Bericht', typeKey: 'voucher-invoice' });
    insertPartnerEvidence(f.deps.db, payment, { kind: 'report', documentId: doc });
    const [row] = unwrap(await listEvidence(f.deps, f.ctx, { paymentId: payment }));
    expect(row).toMatchObject({ documentId: doc, documentNumber: expect.stringMatching(/\S+/) });
  });
});
