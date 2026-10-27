import { newId, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setDatedValue } from '../src/ledger/dated-values';
import { bookEntry } from '../src/ledger/finalize';
import { reverseEntry } from '../src/ledger/reverse';
import { computeVatSummaryReport, vatSummaryTypst } from '../src/reporting/reports/vat-summary';
import { financeAllocationLines, financeCategories, financeEntries, financeMoneyLines } from '../src/schema';
import { ledgerFixture, setupFinance } from './helpers';
import { systemContext } from '@kompass/core/testing';
import { installFinance } from '../src/install';
import { createAccount } from '../src/ledger/accounts';
import { createFirstFiscalYear, ensureFiscalYearFor } from '../src/ledger/fiscal-years';
import { vatSummaryReport, type VatSummaryReport } from '../src/reporting/reports/vat-summary';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const book = (f: Fixture, o: { date: string; cents: number; categoryId: string; taxCode: string; rateKind?: 'standard' | 'reduced' }) =>
  bookEntry(f.deps, f.ctx, { entryDate: o.date, text: 'Umsatz', moneyLines: [{ accountId: f.bank.id, amountCents: o.cents }], allocationLines: [{ categoryId: o.categoryId, amountCents: o.cents, taxCode: o.taxCode, ...(o.rateKind ? { rateKind: o.rateKind } : {}) }] }).then(unwrap);

async function regular() {
  const f = await ledgerFixture();
  unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'regular' }));
  f.deps.db.update(financeCategories).set({ inputTaxDeductible: 'yes' }).where(eq(financeCategories.id, f.programCosts.id)).run();
  return f;
}

describe('Bericht vatSummary (Rechenschaft B1 Task 9)', () => {
  it('owes output tax on a regular income and deducts input tax', async () => {
    const f = await regular();
    await book(f, { date: '2026-03-01', cents: 11900, categoryId: f.purposeIncome.id, taxCode: 'standard' });
    await book(f, { date: '2026-03-02', cents: -1070, categoryId: f.programCosts.id, taxCode: 'reduced' });
    const data = computeVatSummaryReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.byCode.find((c) => c.taxCode === 'standard')).toMatchObject({ rateKind: 'standard', lineCount: 1, netCents: 10000, outputTaxCents: 1900 });
    expect(data.byCode.find((c) => c.taxCode === 'reduced')).toMatchObject({ netCents: 1000, inputTaxCents: 70, notDeductibleCents: 0 });
    expect(data.totals).toEqual({ outputTaxCents: 1900, reverseChargeTaxCents: 0, inputTaxCents: 70, notDeductibleCents: 0, balanceCents: 1830 });
    expect(data.taxation).toEqual([{ from: '2026-01-01', to: '2026-12-31', taxation: 'regular' }]);
    expect(data.warnings).toEqual([]);
  });

  it('owes § 13b tax as a small business, without input tax, and warns about § 18 (4a)', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    await book(f, { date: '2026-04-01', cents: -10000, categoryId: f.programCosts.id, taxCode: 'rc13bEu', rateKind: 'standard' });
    const data = computeVatSummaryReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.byCode).toEqual([expect.objectContaining({ taxCode: 'rc13bEu', reverseChargeTaxCents: 1900, inputTaxCents: 0, notDeductibleCents: 1900 })]);
    // Befund 30 h: Netto mit demselben Vorzeichen wie die Steuer, wie die Bemessungsgrundlage in den Kennzahlen.
    expect(data.byCode[0]!.netCents).toBe(10000);
    expect(data.warnings).toEqual(['section18_4a']);
    expect(vatSummaryTypst(data)).toContain('§ 18 Abs. 4a UStG');
  });

  it('an association that is no entrepreneur is named so, not a small business (Test-Abnahme 2026-10-27)', async () => {
    const none = await ledgerFixture();
    const data = computeVatSummaryReport(none.deps.db, { fiscalYearId: none.year.id });
    expect(data.entrepreneur).toBe(false);
    expect(vatSummaryReport.empty!(data)).toBe('Kein Unternehmer im Sinne des UStG: keine Umsatzsteuer auf eigene Umsätze.');
    expect(vatSummaryTypst(data)).not.toContain('Kleinunternehmer');
    // Unternehmer ab einem Tag im Jahr: dann gilt § 19 für diesen Teil, der Satz bleibt der des Kleinunternehmers.
    unwrap(await setDatedValue(none.deps, none.ctx, { key: 'vatEntrepreneur', validFrom: '2026-07-01', value: true }));
    const later = computeVatSummaryReport(none.deps.db, { fiscalYearId: none.year.id });
    expect(later.entrepreneur).toBe(true);
    expect(vatSummaryReport.empty!(later)).toBe('Kleinunternehmer nach § 19 UStG: keine Umsatzsteuer auf eigene Umsätze.');
  });

  it('a small business gets the sentence and only the § 13b lines; the regular one every code with right-aligned heads', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    await book(f, { date: '2026-04-01', cents: -10000, categoryId: f.programCosts.id, taxCode: 'rc13bEu', rateKind: 'standard' });
    await book(f, { date: '2026-04-02', cents: -1070, categoryId: f.programCosts.id, taxCode: 'reduced' });
    const small = vatSummaryTypst(computeVatSummaryReport(f.deps.db, { fiscalYearId: f.year.id }));
    expect(small).toContain('Kleinunternehmer nach § 19 UStG: keine Umsatzsteuer auf eigene Umsätze.');
    expect(small).not.toContain('ermäßigter Satz');
    expect(small).toContain('§ 13b, Leistung aus der EU (Regelsatz)');
    expect(small).not.toContain('Zahllast');
    const none = await ledgerFixture();
    expect(vatSummaryTypst(computeVatSummaryReport(none.deps.db, { fiscalYearId: none.year.id }))).not.toContain('table.header');
    const g = await regular();
    await book(g, { date: '2026-03-02', cents: -1070, categoryId: g.programCosts.id, taxCode: 'reduced' });
    const full = vatSummaryTypst(computeVatSummaryReport(g.deps.db, { fiscalYearId: g.year.id }));
    expect(full).toContain('ermäßigter Satz');
    // Jeder Kopf über einer Zahl steht rechts wie die Zahl: so viele rechte Köpfe wie Zahlenspalten.
    const head = full.split('\n').find((l) => l.includes('#"Zeilen"'))!;
    expect(head.match(/table\.cell\(align: right\)/g)).toHaveLength(6);
  });

  it('takes the taxation of each line from its day when it changes in the year', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-07-01', value: 'regular' }));
    await book(f, { date: '2026-03-01', cents: 11900, categoryId: f.purposeIncome.id, taxCode: 'standard' });
    await book(f, { date: '2026-08-01', cents: 11900, categoryId: f.purposeIncome.id, taxCode: 'standard' });
    const data = computeVatSummaryReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.taxation).toEqual([{ from: '2026-01-01', to: '2026-06-30', taxation: 'smallBusiness' }, { from: '2026-07-01', to: '2026-12-31', taxation: 'regular' }]);
    expect(data.totals.outputTaxCents).toBe(1900);
    expect(data.byCode[0]).toMatchObject({ lineCount: 2, netCents: 11900 + 10000 });
  });

  it('cancels what was reversed', async () => {
    const f = await regular();
    const entry = await book(f, { date: '2026-03-01', cents: 11900, categoryId: f.purposeIncome.id, taxCode: 'standard' });
    unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    const data = computeVatSummaryReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.totals).toMatchObject({ outputTaxCents: 0, inputTaxCents: 0, balanceCents: 0 });
    expect(data.byCode[0]).toMatchObject({ lineCount: 2, netCents: 0 });
  });

  it('warns and leaves out a line on a day without tax context', async () => {
    const f = await ledgerFixture({ years: ['2006'] });
    // Vor 2007 gibt es keine Sätze — die Dienste ließen das nicht festschreiben, darum direkt eingefügt.
    const id = newId();
    f.deps.db.insert(financeEntries).values({ id, entryDate: '2006-05-01', text: 'Alt', status: 'draft', fiscalYearId: f.year.id, createdByUserId: f.userId, createdChannel: 'ui', createdAt: '2006-05-01T10:00:00.000Z', updatedAt: '2006-05-01T10:00:00.000Z' }).run();
    f.deps.db.insert(financeMoneyLines).values({ id: newId(), entryId: id, position: 0, accountId: f.bank.id, amountCents: 11900 }).run();
    f.deps.db.insert(financeAllocationLines).values({ id: newId(), entryId: id, position: 0, categoryId: f.purposeIncome.id, amountCents: 11900, taxCode: 'standard' }).run();
    f.deps.db.update(financeEntries).set({ number: '2006-0001', status: 'final', finalizedAt: '2006-05-01T12:00:00.000Z', finalizedByUserId: f.userId, finalizedChannel: 'ui' }).where(eq(financeEntries.id, id)).run();
    const data = computeVatSummaryReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.warnings).toEqual(['taxContextMissing']);
    expect(data.byCode).toEqual([]);
    expect(data.totals.balanceCents).toBe(0);
  });
});

/** Plan E6b Task 7 — Summen nach Kalenderjahr mit den Kennzahlen der Jahreserklärung. */
describe('VAT summary by calendar year', () => {
  async function shiftedYears() {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const bank = unwrap(await createAccount(deps, ctx, { name: 'Konto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const first = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2024-07-01', endsOn: '2025-06-30' }));
    const second = deps.db.transaction((tx) => ensureFiscalYearFor(tx, deps, ctx, '2025-07-15'));
    if (!second.ok) throw new Error('Geschäftsjahr 2025/26 fehlt');
    const costs = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'program-costs')).get()!;
    const rc = (date: string, cents: number) => bookEntry(deps, ctx, { entryDate: date, text: 'Software', moneyLines: [{ accountId: bank.id, amountCents: cents }], allocationLines: [{ categoryId: costs.id, amountCents: cents, taxCode: 'rc13bOther' }] }).then(unwrap);
    await rc('2025-11-15', -6000);
    await rc('2026-02-10', -4000);
    return { deps, first, second: second.value };
  }
  const value = (data: VatSummaryReport, source: string) => data.values.find((v) => v.source === source)?.cents ?? 0;

  it('counts the calendar year in which the fiscal year ends', async () => {
    const { deps, first, second } = await shiftedYears();
    const later = computeVatSummaryReport(deps.db, { fiscalYearId: second.id });
    expect(later).toMatchObject({ calendarYear: 2026, formYear: 2026, assumed: false });
    expect(vatSummaryTypst(later)).not.toContain('Muster 2026');
    expect(value(later, 'rc13bOtherBase')).toBe(4000);
    expect(value(later, 'rc13bOtherTax')).toBe(760);
    const body = vatSummaryTypst(later);
    expect(body).toMatch(/"877";\][^\n]*\[40\]/);
    expect(body).toMatch(/"878";\][^\n]*\[7,60\]/);
    const earlier = computeVatSummaryReport(deps.db, { fiscalYearId: first.id });
    expect(earlier).toMatchObject({ calendarYear: 2025, formYear: 2025, assumed: false });
    expect(value(earlier, 'rc13bOtherBase')).toBe(6000);
    expect(vatSummaryReport.yearKind).toBe('calendar');
  });

  it('shows the advance periods with values', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    await book(f, { date: '2026-05-12', cents: -20000, categoryId: f.programCosts.id, taxCode: 'rc13bEu', rateKind: 'standard' });
    const data = computeVatSummaryReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.byPeriod).toEqual([{ period: '2026-Q2', values: expect.objectContaining({ rc13bEuBase: 20000, rc13bEuTax: 3800 }) }]);
    expect(value(data, 'rc13bEuBase')).toBe(20000);
  });
});

