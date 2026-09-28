import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approvePartnerPayment } from '../src/allocation/approvals';
import { addEvidenceLink } from '../src/allocation/evidence';
import { getPartnerPayment, listPartnerPayments, partnerProofDeadlines, savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { FINANCE_DASHBOARD_TILES } from '../src/dashboard';
import { bookEntry } from '../src/ledger/finalize';
import { financeAllocationLines } from '../src/schema';
import { insertDocument, ledgerFixture } from './helpers';

/**
 * U (Prüfer Block 2, Task 6c): Wer anerkennen darf, erfährt, dass Nachweise
 * bereitliegen — nie für die eigene Zahlung. Per MCP über
 * `finance_partner_proof_deadlines` (`readyToAcknowledge`), in der
 * Oberfläche als Zeile der Kachel „Zu tun“.
 */
describe('Nachweise bereit zum Anerkennen', () => {
  it('meldet eine gezahlte Zahlung mit vollständigen Nachweisen der zweiten Person, nie der Anlegerin', async () => {
    const f = await ledgerFixture();
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Bereitpartner e.V.' }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Förderung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000, contactId: org.id }] }));
    const line = f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!.id;
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [line] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));

    const ready = async (ctx: typeof f.ctx) => unwrap(await partnerProofDeadlines(f.deps, ctx, {})).find((d) => d.paymentId === approved.id)?.readyToAcknowledge;
    // U Rest (Recheck sha-0170e73): dasselbe Feld an der Zahlung und in der Liste — eine Quelle mit Kachel und Fristen.
    const atPayment = async (ctx: typeof f.ctx) => unwrap(await getPartnerPayment(f.deps, ctx, { id: approved.id })).readyToAcknowledge;
    const inList = async (ctx: typeof f.ctx) => unwrap(await listPartnerPayments(f.deps, ctx, { partnerId: partner.id })).find((p) => p.id === approved.id)?.readyToAcknowledge;
    const reader = ctxWith(['finance.read'], 'reader-without-approve');
    expect(await ready(f.secondPerson)).toBe(false);
    expect(await atPayment(f.secondPerson)).toBe(false);
    expect(await inList(f.secondPerson)).toBe(false);
    unwrap(await addEvidenceLink(f.deps, f.ctx, { paymentId: approved.id, kind: 'paymentProof', documentId: insertDocument(f, { subject: 'Überweisung', typeKey: 'voucher-invoice' }) }));
    expect(await ready(f.secondPerson)).toBe(true);
    expect(await atPayment(f.secondPerson)).toBe(true);
    expect(await inList(f.secondPerson)).toBe(true);
    // Die Anlegerin selbst darf nie anerkennen — für sie ist nichts bereit; ohne „Freigeben“ ebenso nicht.
    expect(await ready(f.ctx)).toBe(false);
    expect(await atPayment(f.ctx)).toBe(false);
    expect(await inList(f.ctx)).toBe(false);
    expect(await atPayment(reader)).toBe(false);
    expect(await inList(reader)).toBe(false);

    const todo = FINANCE_DASHBOARD_TILES.find((t) => t.key === 'todo')!;
    const forApprover = await todo.load(f.deps, f.secondPerson, {});
    if (forApprover.kind !== 'list') throw new Error('expected list');
    expect(forApprover.lines.find((l) => l.titleKey === 'evidenceReadyToAcknowledge')).toEqual({ titleKey: 'evidenceReadyToAcknowledge', values: { count: 1 }, href: `/finance/partners/${partner.id}/payments/${approved.id}` });
    const forCreator = await todo.load(f.deps, f.ctx, {});
    if (forCreator.kind !== 'list') throw new Error('expected list');
    expect(forCreator.lines.find((l) => l.titleKey === 'evidenceReadyToAcknowledge')).toBeUndefined();
  });
});
