import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { contacts, createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approvePartnerPayment } from '../src/allocation/approvals';
import { foreignActivity } from '../src/allocation/foreign';
import { savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { bookEntry } from '../src/ledger/finalize';
import { foreignActivityReportDefinition } from '../src/reporting/reports/foreign-activity';
import { runFinanceReport } from '../src/reporting/service';
import { insertDocument, ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

async function abroad() {
  const f = await ledgerFixture();
  const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Partnerverein Süd' }));
  const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'foreignBody', usualBasis: 'transfer58' }));
  const pay = async (basis: 'transfer58' | 'agent57', cents: number) => {
    const agreement = insertDocument(f, { subject: 'Vereinbarung', typeKey: 'voucher-invoice' });
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis, purposeText: 'Förderung', agreementDocumentId: agreement, retroactive: false, ...(basis === 'agent57' ? { basisOverrideReason: 'Einmal als Auftrag' } : {}), positions: [{ kind: 'money', amountCents: cents, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    return unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
  };
  const first = await pay('transfer58', 6000);
  const second = await pay('transfer58', 4000);
  const third = await pay('agent57', 2500);
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Spende Ausland', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, abroad: true }] }));
  f.deps.db.update(contacts).set({ country: 'AT' }).where(eq(contacts.id, f.donor.id)).run();
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-02', text: 'Zahlung', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500, contactId: f.donor.id }] }));
  return { f, first, second, third };
}

describe('Bericht foreignActivity (Rechenschaft B1 Task 5)', () => {
  it('holds the same content as the foreign activity service, grouped by basis', async () => {
    const { f, first, second, third } = await abroad();
    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'foreignActivity', params: { fiscalYearId: f.year.id } }));
    const service = unwrap(await foreignActivity(f.deps, f.ctx, { from: '2026-01-01', to: '2026-12-31' }));
    const data = run.data as ReturnType<typeof foreignActivityReportDefinition.compute>;
    expect(data.partnerPayments.flatMap((g) => g.payments.map((p) => p.paymentId)).sort()).toEqual(service.partnerPayments.map((p) => p.paymentId).sort());
    // Joe 2026-10-26 (Designer Runde 8, Fachlich 3): nach dem Merkmal „Wird im Ausland verwendet“, nicht nach dem Sitz —
    // die Zahlung an den Kontakt in Österreich steht nicht im Bericht. Je Zeile Datum, Nr., Kontakt, Text, Betrag.
    expect(data.abroadLines.map((l) => l.entryId)).toEqual(service.otherAbroadLines.map((l) => l.entryId));
    expect(data.abroadLines).toEqual([expect.objectContaining({ entryDate: '2026-04-01', text: 'Spende Ausland', contactName: null, amountCents: 5000 })]);
    expect(JSON.stringify(data)).not.toContain('otherForeignContactLines');
    const body = foreignActivityReportDefinition.toTypst(data, { categoryNames: {}, accountNames: {}, labels: {} });
    expect(body).toContain('Spende Ausland');
    expect(body).not.toContain('Kontakte im Ausland');
    expect(data.partnerPayments.map((g) => [g.basis, g.totalCents])).toEqual([['agent57', 2500], ['transfer58', 10000]]);
    expect(data.partnerPayments.find((g) => g.basis === 'transfer58')!.payments.map((p) => p.paymentId).sort()).toEqual([first.id, second.id].sort());
    expect(data.partnerPayments[0]!.payments[0]).toMatchObject({ paymentId: third.id, proofComplete: false, evidenceCount: 1, partnerName: 'Partnerverein Süd' });
    expect(data.totalCents).toBe(12500);
  });

  it('the approval day on paper is the day in the association\'s zone, without touching the data (F-B3)', async () => {
    const { f } = await abroad();
    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'foreignActivity', params: { fiscalYearId: f.year.id } }));
    const data = run.data as ReturnType<typeof foreignActivityReportDefinition.compute>;
    const edge = { ...data, partnerPayments: data.partnerPayments.map((g) => ({ ...g, payments: g.payments.map((p) => ({ ...p, approvedAt: '2026-12-31T23:30:00.000Z' })) })) };
    const body = foreignActivityReportDefinition.toTypst(edge, { categoryNames: {}, accountNames: {}, labels: { 'setting.timeZone': 'Europe/Berlin' } });
    expect(body).toContain('01.01.2027');
    expect(body).not.toContain('31.12.2026');
  });

  it('does not follow the seat of a contact: the country of the organisation leaves the data as it is', async () => {
    const { f } = await abroad();
    const de = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'foreignActivity', params: { fiscalYearId: f.year.id } }));
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'organization.country', 'AT'));
    const at = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'foreignActivity', params: { fiscalYearId: f.year.id } }));
    expect(at.hash).toBe(de.hash);
  });

  it('needs finance.read', async () => {
    const { f } = await abroad();
    expect(err(await runFinanceReport(f.deps, ctxWith(['finance.overview'], f.userId), { report: 'foreignActivity', params: { fiscalYearId: f.year.id } }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });

  it('shows endowments (§ 58 Nr. 3 AO) as a basis of their own and keeps the data unchanged without one (Rechenschaft D2)', async () => {
    const { f } = await abroad();
    const before = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'foreignActivity', params: { fiscalYearId: f.year.id } }));
    expect(JSON.stringify(before.data)).not.toContain('assetEndowment');
    const body = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Stiftung Inland' }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: body.id, status: 'publicBody' }));
    const agreement = insertDocument(f, { subject: 'Vereinbarung', typeKey: 'voucher-invoice' });
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Ausstattung', agreementDocumentId: agreement, retroactive: false, assetEndowment: true, positions: [{ kind: 'money', amountCents: 7000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    const after = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'foreignActivity', params: { fiscalYearId: f.year.id } }));
    const data = after.data as ReturnType<typeof foreignActivityReportDefinition.compute>;
    expect(data.partnerPayments.map((g) => [g.basis, g.totalCents])).toEqual([['agent57', 2500], ['endowment58', 7000], ['transfer58', 10000]]);
    expect(foreignActivityReportDefinition.toTypst(data, { categoryNames: {}, accountNames: {}, labels: {} })).toContain('Vermögensausstattung (§ 58 Nr. 3 AO)');
  });
});
