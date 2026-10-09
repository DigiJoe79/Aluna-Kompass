import { schema, unwrap, writeSettingInternal, systemContext } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { acknowledgeEvidence, addEvidenceLink, addEvidenceUpload, removeEvidence, updateEvidence } from '../src/allocation/evidence';
import { bookEntry } from '../src/ledger/finalize';
import { savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { approvePartnerPayment } from '../src/allocation/approvals';
import { savePartnerProfile } from '../src/allocation/partners';
import { financeAllocationLines, financePartnerEvidence, financePartnerPayments } from '../src/schema';
import { allowHumanOnlyOverMcp, insertDocument, ledgerFixture, pdfBytes } from './helpers';

async function submittedPayment(f: Awaited<ReturnType<typeof ledgerFixture>>, retroactive = false) {
  const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Nachweispartner e.V.' }));
  // `publicBody` statt `taxExemptBody`, damit die Bescheid-Warnung (Task 4) diese Fixtur nicht betrifft.
  const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
  if (!retroactive) {
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: false, positions: [{ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    return { partner, payment: submitted };
  }
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId: org.id }] }));
  const lineId = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
  const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [lineId] }));
  const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
  return { partner, payment: submitted };
}

describe('addEvidenceUpload / addEvidenceLink (F7 Task 3)', () => {
  it('uploads a PDF as evidence, in the name of the payment, with a subject that names kind and date but never the partner', async () => {
    const f = await ledgerFixture();
    const { payment } = await submittedPayment(f);
    const added = unwrap(await addEvidenceUpload(f.deps, f.ctx, { paymentId: payment.id, kind: 'agreement', bytes: pdfBytes(), fileName: 'zusage.pdf' }));
    expect(added.kind).toBe('agreement');
    expect(added.documentId).not.toBeNull();
  });

  it('AL: der gespeicherte Betreff nennt die Art in Worten („Zahlungsnachweis vom …“), in der Leitsprache der Installation', async () => {
    const f = await ledgerFixture();
    const { payment } = await submittedPayment(f);
    const added = unwrap(await addEvidenceUpload(f.deps, f.ctx, { paymentId: payment.id, kind: 'paymentProof', bytes: pdfBytes(), fileName: 'ueberweisung.pdf' }));
    const subject = f.deps.db.select({ subject: documents.subject }).from(documents).where(eq(documents.id, added.documentId!)).get()!.subject;
    expect(subject).toMatch(/^Zahlungsnachweis vom \d{2}\.\d{2}\.\d{4}$/);
    // Leitsprache ohne eigene Tabelle: der Betreff bleibt deutsch, nie der Code.
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'i18n.locales', ['en', 'de']));
    const report = unwrap(await addEvidenceUpload(f.deps, f.ctx, { paymentId: payment.id, kind: 'report', bytes: pdfBytes(), fileName: 'bericht.pdf' }));
    expect(f.deps.db.select({ subject: documents.subject }).from(documents).where(eq(documents.id, report.documentId!)).get()!.subject).toMatch(/^Bericht vom /);
  });

  it('links an existing, issued document of the file — the same document may be evidence at more than one payment', async () => {
    const f = await ledgerFixture();
    const { payment: paymentA } = await submittedPayment(f);
    const { payment: paymentB } = await submittedPayment(f);
    const docId = insertDocument(f, { subject: 'Zusage', typeKey: 'voucher-invoice' });
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: paymentA.id, kind: 'agreement', documentId: docId }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: paymentB.id, kind: 'agreement', documentId: docId }));
    const rows = f.deps.db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.documentId, docId)).all();
    expect(rows).toHaveLength(2);
  });

  it('requires a German explanation for a foreign-language evidence, and a covered amount only for the settlement (V)', async () => {
    const f = await ledgerFixture();
    const { payment } = await submittedPayment(f);
    const docId = insertDocument(f, { subject: 'Bericht', typeKey: 'voucher-invoice' });
    const noExplanation = await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'report', documentId: docId, foreignLanguage: true });
    expect(noExplanation.ok).toBe(false);
    const noAmount = await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'settlement', documentId: docId });
    expect(noAmount.ok).toBe(false);
    const ok1 = unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'settlement', documentId: docId, coveredCents: 5000 }));
    expect(ok1.coveredCents).toBe(5000);
    // „Rechnung oder Abrechnung“ einer Förderung trägt keinen Betrag.
    expect(unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'invoice', documentId: docId })).coveredCents).toBeNull();
  });

  it('refuses evidence on a draft or a rejected payment', async () => {
    const f = await ledgerFixture();
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Entwurfspartner' }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'taxExemptBody' }));
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [] }));
    const docId = insertDocument(f, { subject: 'Doc', typeKey: 'voucher-invoice' });
    const denied = await addEvidenceLink(f.deps, f.ctx, { paymentId: draft.id, kind: 'agreement', documentId: docId });
    expect(denied.ok).toBe(false);
  });
});

describe('updateEvidence / removeEvidence (F7 Task 3)', () => {
  it('edits and removes evidence before the acknowledgement', async () => {
    const f = await ledgerFixture();
    const { payment } = await submittedPayment(f);
    const docId = insertDocument(f, { subject: 'Zusage', typeKey: 'voucher-invoice' });
    const added = unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'agreement', documentId: docId }));
    const updated = unwrap(await updateEvidence(f.deps, f.ctx, { id: added.id, explanationDe: 'Nachträglich ergänzt' }));
    expect(updated.explanationDe).toBe('Nachträglich ergänzt');
    unwrap(await removeEvidence(f.deps, f.ctx, { id: added.id }));
    expect(f.deps.db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.id, added.id)).get()).toBeUndefined();
  });
});

describe('acknowledgeEvidence (F7 Task 3, Annahme 11, Review Focus 4)', () => {
  async function approvedPayment(f: Awaited<ReturnType<typeof ledgerFixture>>) {
    const { partner, payment } = await submittedPayment(f, true);
    f.deps.db.update(financePartnerPayments).set({ state: 'approved', approvedAt: '2026-03-05T09:00:00.000Z', approvedByUserId: f.secondPersonId, number: 'PZ-2026-777' }).where(eq(financePartnerPayments.id, payment.id)).run();
    return { partner, payment: f.deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, payment.id)).get()! };
  }

  it('refuses to acknowledge without an explanation on a foreign-language evidence (Review Focus 4)', async () => {
    const f = await ledgerFixture();
    allowHumanOnlyOverMcp(f.deps);
    const { payment } = await approvedPayment(f);
    const docId = insertDocument(f, { subject: 'Bericht', typeKey: 'voucher-invoice' });
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'report', documentId: docId, foreignLanguage: true, explanationDe: 'Verwendung wie geplant' }));
    // Die Erläuterung wird nach dem Verknüpfen geleert, um Annahme 11 gegen einen direkt eingefügten Datensatz zu prüfen:
    f.deps.db.update(financePartnerEvidence).set({ explanationDe: null }).where(eq(financePartnerEvidence.paymentId, payment.id)).run();
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'agreement', documentId: insertDocument(f, { subject: 'Zusage', typeKey: 'voucher-invoice' }) }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'paymentProof', documentId: insertDocument(f, { subject: 'Nachweis', typeKey: 'voucher-invoice' }) }));
    const denied = await acknowledgeEvidence(f.deps, f.secondPerson, { paymentId: payment.id });
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied)).toContain('evidenceExplanationMissing');
  });

  it('AM: vor der Zahlung nennt die Ablehnung die Nummer als Verwendungszweck — keine Person kann das lösen', async () => {
    const f = await ledgerFixture();
    allowHumanOnlyOverMcp(f.deps);
    const { payment: submitted } = await submittedPayment(f);
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: approved.id, kind: 'agreement', documentId: insertDocument(f, { subject: 'Zusage', typeKey: 'voucher-invoice' }) }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: approved.id, kind: 'paymentProof', documentId: insertDocument(f, { subject: 'Nachweis', typeKey: 'voucher-invoice' }) }));
    const denied = await acknowledgeEvidence(f.deps, f.secondPerson, { paymentId: approved.id });
    expect(denied.ok).toBe(false);
    expect(denied.ok ? null : denied.error).toMatchObject({ code: 'evidenceNotYetPaid', params: { number: approved.number } });
  });

  it('records the acknowledgement channel, and refuses a second attempt', async () => {
    const f = await ledgerFixture();
    allowHumanOnlyOverMcp(f.deps);
    const { payment } = await approvedPayment(f);
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'agreement', documentId: insertDocument(f, { subject: 'Zusage', typeKey: 'voucher-invoice' }) }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'paymentProof', documentId: insertDocument(f, { subject: 'Nachweis', typeKey: 'voucher-invoice' }) }));
    const acknowledged = unwrap(await acknowledgeEvidence(f.deps, f.secondPerson, { paymentId: payment.id }));
    expect(acknowledged).toMatchObject({ acknowledgedByUserId: f.secondPersonId, acknowledgedChannel: 'ui' });
    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.partnerPayment.acknowledge');
    expect(log).toHaveLength(1);

    const again = await acknowledgeEvidence(f.deps, f.secondPerson, { paymentId: payment.id });
    expect(again.ok).toBe(false);
  });

  it('refuses when the person who created the payment tries to acknowledge it (≠ Anleger)', async () => {
    const f = await ledgerFixture();
    allowHumanOnlyOverMcp(f.deps);
    const { payment } = await approvedPayment(f);
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'agreement', documentId: insertDocument(f, { subject: 'Zusage', typeKey: 'voucher-invoice' }) }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: payment.id, kind: 'paymentProof', documentId: insertDocument(f, { subject: 'Nachweis', typeKey: 'voucher-invoice' }) }));
    const denied = await acknowledgeEvidence(f.deps, f.ctx, { paymentId: payment.id });
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied)).toContain('partnerPaymentOwnCreator');
  });

  it('requires the settlement of an agent mandate to add up to the full amount before acknowledging — a plain funding transfer needs no coverage', async () => {
    const f = await ledgerFixture();
    allowHumanOnlyOverMcp(f.deps);
    const agentContact = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Vermittler für Deckung e.V.' }));
    const agent = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: agentContact.id, status: 'agent' }));
    const ownAgreement = insertDocument(f, { subject: 'Auftrag', typeKey: 'voucher-invoice' });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Auftrag', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId: agentContact.id }] }));
    const lineId = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: agent.id, basis: 'agent57', purposeText: 'Verteilung Futterspenden', agreementDocumentId: ownAgreement, retroactive: true, positions: [], paidLineIds: [lineId] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    f.deps.db.update(financePartnerPayments).set({ state: 'approved', approvedAt: '2026-03-05T09:00:00.000Z', approvedByUserId: f.secondPersonId, number: 'PZ-2026-778' }).where(eq(financePartnerPayments.id, submitted.id)).run();

    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: submitted.id, kind: 'agreement', documentId: insertDocument(f, { subject: 'Vereinbarung', typeKey: 'voucher-invoice' }) }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: submitted.id, kind: 'paymentProof', documentId: insertDocument(f, { subject: 'Nachweis', typeKey: 'voucher-invoice' }) }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: submitted.id, kind: 'report', documentId: insertDocument(f, { subject: 'Bericht', typeKey: 'voucher-invoice' }) }));
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: submitted.id, kind: 'settlement', documentId: insertDocument(f, { subject: 'Abrechnung', typeKey: 'voucher-invoice' }), coveredCents: 1000 }));
    const incomplete = await acknowledgeEvidence(f.deps, f.secondPerson, { paymentId: submitted.id });
    expect(incomplete.ok).toBe(false);
    expect(JSON.stringify(incomplete)).toContain('evidenceCoverageIncomplete');

    unwrap(await updateEvidence(f.deps, f.ctx, { id: (f.deps.db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.paymentId, submitted.id)).all().find((e) => e.kind === 'settlement'))!.id, coveredCents: 5000 }));
    const complete = unwrap(await acknowledgeEvidence(f.deps, f.secondPerson, { paymentId: submitted.id }));
    expect(complete.acknowledgedAt).not.toBeNull();
  });
});
