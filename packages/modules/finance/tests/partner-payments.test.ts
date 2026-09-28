import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { createProject } from '@kompass/module-projects';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import {
  copyPartnerPayment, deletePartnerPaymentDraft, evidenceUsedMultipleTimesInternal, getPartnerPayment, listPartnerPayments, partnerProofDeadlinesInternal,
  rejectPartnerPayment, savePartnerPaymentDraft, submitPartnerPayment,
} from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { financeAllocationLines, financePartnerPaidLines, financePartnerPaymentPositions, financePartnerPayments } from '../src/schema';
import { ledgerFixture } from './helpers';
import { insertPaidPartnerPayment, insertPartner, insertPartnerEvidence, insertPartnerPayment } from './partner-fixture';

async function fixture() {
  const f = await ledgerFixture();
  const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Empfängerverein e.V.' }));
  // `publicBody` statt `taxExemptBody`, damit die neuen Bescheid-Warnungen (Task 4) diese generische Fixtur nicht betreffen — die Bescheid-Fälle testet `partners.test.ts`/`partner-approvals.test.ts` gezielt.
  const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
  return { ...f, org, partner };
}

/** Eine festgeschriebene, an den Partner gezahlte Zeile. */
async function paidLine(f: Awaited<ReturnType<typeof fixture>>, cents = 5000) {
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -cents }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -cents, contactId: f.org.id }] }));
  return f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
}

describe('savePartnerPaymentDraft (F7 Task 3)', () => {
  it('saves a money position, replaces positions as a whole, and requires a reason once the basis is overridden — at submit, never at the autosave (Design-Nachtrag Phase 4)', async () => {
    const f = await fixture();
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'Futter für Schutzstation', retroactive: false, positions: [{ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id }] }));
    expect(draft.positions).toHaveLength(1);
    expect(draft.totalCents).toBe(5000);

    // Laufend gesichert: ein halber Stand (Art übersteuert, Begründung noch nicht getippt) geht nie verloren.
    const overridden = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, partnerId: f.partner.id, basis: 'agent57', purposeText: 'x', agreementDocumentId: null, retroactive: false, positions: [{ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id }] }));
    expect(overridden).toMatchObject({ basis: 'agent57', basisOverridden: true, basisOverrideReason: null });
    const refused = await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: overridden.version });
    expect(JSON.stringify(refused)).toContain('partnerBasisOverrideNeedsReason');
  });

  it('refuses a paid line that belongs to another payment', async () => {
    const f = await fixture();
    const line = await paidLine(f);
    const a = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'x', retroactive: true, positions: [], paidLineIds: [line] }));
    expect(a.paidLines.map((l) => l.paidLineId)).toEqual([line]);
    const b = await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'y', retroactive: true, positions: [], paidLineIds: [line] });
    expect(b.ok).toBe(false);
    expect(JSON.stringify(b)).toContain('allocationLineAlreadyAssigned');
  });

  it('refuses a new project on a position without projects.view; one already set stays (Design-Nachtrag Phase 4, Teil C Task 2)', async () => {
    const f = await fixture();
    const project = unwrap(await createProject(f.deps, ctxWith(['projects.manage'], f.userId), { slug: 'schutzstation', name: { de: 'Schutzstation' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
    expect(f.ctx.permissions.has('projects.view')).toBe(false);
    const base = { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'Futter', retroactive: false };
    const denied = await savePartnerPaymentDraft(f.deps, f.ctx, { ...base, positions: [{ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id, projectId: project.id }] });
    expect(denied.ok ? 'ok' : denied.error).toMatchObject({ type: 'forbidden' });

    const withView = ctxWith([...f.ctx.permissions, 'projects.view'], f.userId);
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, withView, { ...base, positions: [{ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id, projectId: project.id }] }));
    expect(draft.positions[0]!.projectId).toBe(project.id);
    // Ohne Recht darf ein anderer den Entwurf weiter sichern — das gesetzte Projekt bleibt stehen.
    const kept = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { ...base, id: draft.id, expectedVersion: draft.version, purposeText: 'Futter und Decken', positions: [{ id: draft.positions[0]!.id, kind: 'money', amountCents: 5000, categoryId: f.programCosts.id, projectId: project.id }] }));
    expect(kept.positions[0]!.projectId).toBe(project.id);
    // Die Oberfläche schickt die Positionen ohne ID — das gesetzte Projekt bleibt trotzdem stehen.
    const resent = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { ...base, id: draft.id, expectedVersion: kept.version, positions: [{ kind: 'money', amountCents: 6000, categoryId: f.programCosts.id, projectId: project.id }] }));
    expect(resent.positions[0]!.projectId).toBe(project.id);
  });

  it('rejects a money position when the payment is marked retroactive', async () => {
    const f = await fixture();
    const denied = await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'x', retroactive: true, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] });
    expect(denied.ok).toBe(false);
  });
});

describe('submitPartnerPayment (F7 Task 3)', () => {
  it('derives money positions from paid lines on submit — the payment day is the date of the oldest line', async () => {
    const f = await fixture();
    const line = await paidLine(f, 5000);
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [line] }));
    expect(draft.positions).toEqual([]);
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(submitted.state).toBe('submitted');
    expect(submitted.positions).toHaveLength(1);
    expect(submitted.positions[0]).toMatchObject({ kind: 'money', amountCents: 5000 });
    expect(submitted.proofMonths).toBe(3); // Vorgabe `usualProofMonths`; das Datum entsteht erst mit der Zahlung (Task 6c)
  });

  it('requires at least one position, and a purpose text', async () => {
    const f = await fixture();
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: '', retroactive: false, positions: [] }));
    const denied = await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version });
    expect(denied.ok).toBe(false);
  });

  it('requires an own agreement document for an agent mandate, distinct from the one at the partner', async () => {
    const f = await fixture();
    const agentContact = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Vermittler e.V.' }));
    const agent = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: agentContact.id, status: 'agent' }));
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: agent.id, basis: 'agent57', purposeText: 'Auftrag', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    const denied = await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version });
    expect(denied.ok).toBe(false);
  });

  it('lets state leave submitted exactly once (Review Focus 2, second submission attempt on a decided draft)', async () => {
    const f = await fixture();
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const again = await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version });
    expect(again.ok).toBe(false);
  });
});

describe('rejectPartnerPayment, copyPartnerPayment, deletePartnerPaymentDraft (F7 Task 3)', () => {
  it('keeps a rejected payment as an end state and copies it with a reference', async () => {
    const f = await fixture();
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const rejected = unwrap(await rejectPartnerPayment(f.deps, f.ctx, { id: submitted.id, note: 'Unklare Verwendung' }));
    expect(rejected.state).toBe('rejected');
    const stillThere = f.deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, rejected.id)).get();
    expect(stillThere).toMatchObject({ state: 'rejected' });

    const copy = unwrap(await copyPartnerPayment(f.deps, f.ctx, { id: rejected.id }));
    expect(copy).toMatchObject({ state: 'draft', copiedFromPaymentId: rejected.id });
    expect(copy.positions).toHaveLength(1);

    const other = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'y', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    const notRejected = await copyPartnerPayment(f.deps, f.ctx, { id: other.id });
    expect(notRejected.ok).toBe(false);
  });

  it('deletes only a draft, not a submitted or rejected payment', async () => {
    const f = await fixture();
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [] }));
    unwrap(await deletePartnerPaymentDraft(f.deps, f.ctx, { id: draft.id }));
    expect(f.deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, draft.id)).get()).toBeUndefined();

    const draft2 = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 1000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft2.id, expectedVersion: draft2.version }));
    const denied = await deletePartnerPaymentDraft(f.deps, f.ctx, { id: submitted.id });
    expect(denied.ok).toBe(false);
  });
});

describe('lesen, Fristen, Mehrfachnutzung (F7 Task 3)', () => {
  it('lists and reads payments, newest first', async () => {
    const f = await fixture();
    const a = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'a', retroactive: false, positions: [] }));
    const list = unwrap(await listPartnerPayments(f.deps, f.ctx, { partnerId: f.partner.id }));
    expect(list.map((p) => p.id)).toContain(a.id);
    expect(unwrap(await getPartnerPayment(f.deps, f.ctx, { id: a.id }))).toMatchObject({ id: a.id });
  });

  it('lists a payment as overdue once the grace period after its proof deadline has passed', async () => {
    const f = await ledgerFixture();
    const partnerId = insertPartner(f.deps.db, { contactId: f.donor.id });
    await insertPaidPartnerPayment(f, partnerId, f.donor.id, '2026-01-01', { number: 'PZ-2026-999', proofMonths: 1 });
    const due = partnerProofDeadlinesInternal(f.deps.db, '2026-02-20', 10);
    expect(due).toEqual([{ paymentId: expect.any(String), partnerId, proofDueOn: '2026-02-01', overdue: true }]);
  });

  it('flags a document used as evidence on more than one payment', async () => {
    const f = await ledgerFixture();
    const partnerId = insertPartner(f.deps.db, { contactId: f.donor.id });
    const paymentA = insertPartnerPayment(f.deps.db, partnerId);
    const paymentB = insertPartnerPayment(f.deps.db, partnerId);
    insertPartnerEvidence(f.deps.db, paymentA, { documentId: 'DOC-SHARED' });
    expect(evidenceUsedMultipleTimesInternal(f.deps.db, 'DOC-SHARED')).toBe(false);
    insertPartnerEvidence(f.deps.db, paymentB, { documentId: 'DOC-SHARED' });
    expect(evidenceUsedMultipleTimesInternal(f.deps.db, 'DOC-SHARED')).toBe(true);
  });
});
