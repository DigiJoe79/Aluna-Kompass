import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getContactTaxDetails, saveContactTaxDetails } from '../src/allocation/contact-tax-details';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { getEntry, saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { reverseEntry } from '../src/ledger/reverse';
import { computeIncomeStatementReport } from '../src/reporting/reports/income-statement';
import { computeVatSummaryReport } from '../src/reporting/reports/vat-summary';
import { ledgerFixture } from './helpers';

type F = Awaited<ReturnType<typeof ledgerFixture>>;
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

async function supplier(f: F, name: string, country: string, reverseCharge: 'eu' | 'other' | null) {
  const contact = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name, country }));
  if (reverseCharge) unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: contact.id, reverseCharge }));
  return contact;
}

const expense = (f: F, line: Record<string, unknown>, date = '2026-05-12') =>
  bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Werbeanzeigen', moneyLines: [{ accountId: f.bank.id, amountCents: -20000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -20000, ...line }] });

/** Plan E6a Task 3 — § 13b getrennt nach EU und übrigen Leistungen, Leistungsdatum, Vorgabe am Kontakt. */
describe('reverse-charge lines', () => {
  it('keeps the reverse-charge mark at the contact without naming the contact in the log', async () => {
    const f = await ledgerFixture();
    const c = await supplier(f, 'Werbenetz Test Ltd.', 'IE', 'eu');
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: c.id }))).toMatchObject({ reverseCharge: 'eu' });
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: c.id, reverseCharge: null }));
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: c.id }))).toMatchObject({ reverseCharge: null });
  });

  it('defaults the reverse-charge code from the contact', async () => {
    const f = await ledgerFixture();
    const eu = await supplier(f, 'Werbenetz Test Ltd.', 'IE', 'eu');
    const other = await supplier(f, 'Codewerk Test Ltd.', 'GB', 'other');
    expect(unwrap(await expense(f, { contactId: eu.id })).allocationLines[0]!.taxCode).toBe('rc13bEu');
    expect(unwrap(await expense(f, { contactId: other.id })).allocationLines[0]!.taxCode).toBe('rc13bOther');
    expect(unwrap(await expense(f, { contactId: eu.id, taxCode: 'none' })).allocationLines[0]!.taxCode).toBe('none');
    const income = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-05-12', text: 'Erstattung', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.purposeIncome.id, amountCents: 1000, contactId: eu.id }] }));
    expect(income.allocationLines[0]!.taxCode).toBe(f.purposeIncome.defaultTaxCode);
  });

  it('keeps a service date only on reverse-charge lines', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    const entry = unwrap(await expense(f, { taxCode: 'rc13bEu', serviceDate: '2026-03-20' }));
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: entry.id })).allocationLines[0]!.serviceDate).toBe('2026-03-20');
    expect(fields(await expense(f, { taxCode: 'standard', serviceDate: '2026-03-20' }))).toEqual(['allocationLines.0.serviceDate:notApplicable']);
    expect(fields(await saveDraft(f.deps, f.ctx, { entryDate: '2026-05-12', text: 'x', moneyLines: [], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -100, serviceDate: '2026-03-20' }] }))).toEqual(['allocationLines.0.serviceDate:notApplicable']);
  });

  it('corrects the reverse-charge code and service date', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    const entry = unwrap(await expense(f, { taxCode: 'none' }));
    const lineId = entry.allocationLines[0]!.id;
    const before = computeIncomeStatementReport(f.deps.db, { fiscalYearId: f.year.id });
    const result = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId, changes: { taxCode: 'rc13bEu', serviceDate: '2026-04-30' }, note: 'Leistung aus Irland' }));
    expect(result.applied).toBe(true);
    expect(result.notices).toEqual([]);
    const after = unwrap(await getEntry(f.deps, f.ctx, { id: entry.id })).allocationLines[0]!;
    expect(after).toMatchObject({ taxCode: 'rc13bEu', serviceDate: '2026-04-30' });
    expect(computeIncomeStatementReport(f.deps.db, { fiscalYearId: f.year.id })).toEqual(before);
    const standard = unwrap(await expense(f, { taxCode: 'standard' }));
    expect(fields(await requestAllocationCorrection(f.deps, f.ctx, { lineId: standard.allocationLines[0]!.id, changes: { taxCode: 'rc13bEu' }, note: 'x' }))).toEqual(['changes.taxCode:notCorrectable']);
    const income = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-05-12', text: 'Einnahme', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    expect(fields(await requestAllocationCorrection(f.deps, f.ctx, { lineId: income.allocationLines[0]!.id, changes: { taxCode: 'rc13bEu' }, note: 'x' }))).toEqual(['changes.taxCode:notCorrectable']);
    const none = unwrap(await expense(f, { taxCode: 'none' }));
    expect(fields(await requestAllocationCorrection(f.deps, f.ctx, { lineId: none.allocationLines[0]!.id, changes: { serviceDate: '2026-04-30' }, note: 'x' }))).toEqual(['changes.serviceDate:notApplicable']);
  });

  it('gives the reversal the tax point of the original', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    f.deps.clock.set('2026-08-03T10:00:00.000Z');
    const plain = unwrap(await expense(f, { taxCode: 'rc13bEu' }));
    const r1 = unwrap(await reverseEntry(f.deps, f.ctx, { id: plain.id }));
    expect(r1.reversal.allocationLines[0]!.serviceDate).toBe('2026-05-12');
    const dated = unwrap(await expense(f, { taxCode: 'rc13bEu', serviceDate: '2026-04-30' }));
    const r2 = unwrap(await reverseEntry(f.deps, f.ctx, { id: dated.id }));
    expect(r2.reversal.allocationLines[0]!.serviceDate).toBe('2026-04-30');
  });

  it('shows both reverse-charge codes as their own rows in the VAT summary', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    unwrap(await expense(f, { taxCode: 'rc13bEu' }));
    unwrap(await expense(f, { taxCode: 'rc13bOther' }));
    const data = computeVatSummaryReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.byCode.map((c) => c.taxCode)).toEqual(['rc13bEu', 'rc13bOther']);
    expect(data.totals.reverseChargeTaxCents).toBe(7600);
  });
});
