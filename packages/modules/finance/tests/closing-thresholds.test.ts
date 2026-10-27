import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getThresholds, type ThresholdKey } from '../src/closing/thresholds';
import { createCategory } from '../src/ledger/categories';
import { setDatedValue } from '../src/ledger/dated-values';
import { bookEntry } from '../src/ledger/finalize';
import { financeCategories } from '../src/schema';
import { ledgerFixture, setupFinance } from './helpers';
import { systemContext } from '@kompass/core/testing';
import { installFinance } from '../src/install';
import { createAccount } from '../src/ledger/accounts';
import { createFirstFiscalYear, ensureFiscalYearFor } from '../src/ledger/fiscal-years';
import { incomeStatement } from '../src/ledger/queries';

async function setup(years: string[] = ['2025', '2026']) {
  const f = await ledgerFixture({ years });
  const cat = (key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
  const book = (date: string, key: string, cents: number, line: Record<string, unknown> = {}) =>
    bookEntry(f.deps, f.ctx, { entryDate: date, text: key, moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: cat(key).id, amountCents: cents, ...line }] }).then(unwrap);
  const thresholds = async (year: string, ctx = f.ctx) => unwrap(await getThresholds(f.deps, ctx, { fiscalYearId: f.years[year]!.id }));
  const one = async (year: string, key: ThresholdKey, ctx = f.ctx) => (await thresholds(year, ctx)).find((t) => t.key === key)!;
  return { f, book, thresholds, one };
}

describe('Schwellenwächter (Rechenschaft C, Finanz-Spec § 9.5)', () => {
  it('lists the thresholds of a year; reading needs finance.overview', async () => {
    const { f, thresholds } = await setup();
    expect((await thresholds('2026')).map((t) => t.key)).toEqual(['timelyUse', 'business', 'businessCombined', 'smallBusinessPrevYear', 'smallBusinessCurrent', 'allowanceVolunteer', 'allowanceTrainer', 'simplifiedReceipt']);
    expect(await getThresholds(f.deps, ctxWith(['finance.expensesSubmit'], f.userId), { fiscalYearId: f.years['2026']!.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect((await thresholds('2026')).find((t) => t.key === 'simplifiedReceipt')).toEqual({ key: 'simplifiedReceipt', state: 'info', valueCents: null, limitCents: 30000, notes: [], person: null });
  });

  it('business: performance-related income only, quiet, approaching, exceeded', async () => {
    const { f, book, one } = await setup();
    unwrap(await createCategory(f.deps, f.ctx, { key: 'business-grant', name: 'Zuschuss Gaststätte', direction: 'income', sphere: 'business', incomeKind: 'publicGrant', thresholdExclusion: 'notPerformance' }));
    await book('2026-02-01', 'business-grant', 4500000);
    await book('2026-02-02', 'vat-refund', 900000);
    expect(await one('2026', 'business')).toMatchObject({ state: 'quiet', valueCents: 0, limitCents: 5000000 });
    await book('2026-03-01', 'sales', 4100000, { taxCode: 'standard' });
    expect(await one('2026', 'business')).toMatchObject({ state: 'approaching', valueCents: 4100000 });
    await book('2026-03-02', 'sales', 1000000, { taxCode: 'standard' });
    expect(await one('2026', 'business')).toMatchObject({ state: 'exceeded', valueCents: 5100000 });
  });

  it('timely use: revenue per § 55, below the limit no obligation', async () => {
    const { book, one } = await setup();
    await book('2026-02-01', 'donations', 5000000);
    expect(await one('2026', 'timelyUse')).toMatchObject({ state: 'noObligation', valueCents: 5000000, limitCents: 10000000 });
    await book('2026-02-02', 'donations', 6000000);
    expect(await one('2026', 'timelyUse')).toMatchObject({ state: 'exceeded', valueCents: 11000000 });
  });

  it('timely use before 2021 does not apply', async () => {
    const { one } = await setup(['2020']);
    expect(await one('2020', 'timelyUse')).toMatchObject({ state: 'notApplicable', limitCents: null });
  });

  it('business and purpose operation combined from 2026, with the result', async () => {
    const { book, one } = await setup();
    await book('2025-03-01', 'sales', 4000000, { taxCode: 'standard' });
    expect(await one('2025', 'businessCombined')).toMatchObject({ state: 'notApplicable', limitCents: null });
    await book('2026-03-01', 'sales', 4500000, { taxCode: 'standard' });
    await book('2026-03-02', 'purpose-income', 1000000, { taxCode: 'reduced' });
    expect(await one('2026', 'businessCombined')).toMatchObject({ state: 'exceeded', valueCents: 5500000, notes: ['resultPositive'] });
  });

  it('small business: previous year and current year turnover, gross under smallBusiness, net under regular', async () => {
    const { f, book, one } = await setup();
    await book('2025-03-01', 'sales', 3000000, { taxCode: 'standard' });
    await book('2025-03-02', 'donations', 9000000);
    expect(await one('2025', 'smallBusinessPrevYear')).toMatchObject({ state: 'exceeded', valueCents: 3000000, limitCents: 2500000, notes: ['noPreviousYear'] });
    expect(await one('2026', 'smallBusinessPrevYear')).toMatchObject({ state: 'exceeded', valueCents: 3000000, notes: [] });
    await book('2026-03-01', 'sales', 1190000, { taxCode: 'standard' });
    expect(await one('2026', 'smallBusinessCurrent')).toMatchObject({ state: 'quiet', valueCents: 1190000, limitCents: 10000000 });
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'regular' }));
    expect(await one('2026', 'smallBusinessCurrent')).toMatchObject({ state: 'notApplicable' });
  });

  it('small business before 2025 is not modelled', async () => {
    const { one } = await setup(['2024', '2025']);
    expect(await one('2024', 'smallBusinessCurrent')).toMatchObject({ state: 'notModelled', limitCents: null });
    expect(await one('2024', 'smallBusinessPrevYear')).toMatchObject({ state: 'notModelled' });
  });

  it('allowances: the highest sum per person, the person only with finance.read', async () => {
    const { f, book, one } = await setup();
    await book('2026-04-01', 'volunteer-allowance', -50000, { contactId: f.donor.id });
    await book('2026-04-02', 'volunteer-allowance', -20000, { contactId: f.rightDonor.id });
    expect(await one('2026', 'allowanceVolunteer')).toMatchObject({ state: 'quiet', valueCents: 50000, limitCents: 96000, person: { contactId: f.donor.id, name: 'Musterspenderin' } });
    await book('2026-05-01', 'volunteer-allowance', -30000, { contactId: f.donor.id });
    expect(await one('2026', 'allowanceVolunteer')).toMatchObject({ state: 'approaching', valueCents: 80000 });
    expect((await one('2026', 'allowanceVolunteer', ctxWith(['finance.overview'], f.userId))).person).toBeNull();
    expect(await one('2026', 'allowanceTrainer')).toMatchObject({ state: 'quiet', valueCents: 0, person: null });
  });

  it('names a profit only above zero, with the same sum as the income statement (§ 64 Abs. 3 S. 2 AO)', async () => {
    const { book, one, f } = await setup();
    await book('2026-03-01', 'sales', 100000, { taxCode: 'standard' });
    await book('2026-03-02', 'business-costs', -100000);
    expect((await one('2026', 'businessCombined')).notes).toEqual(['resultNotPositive']);
    await book('2026-03-03', 'sales', 1, { taxCode: 'standard' });
    expect((await one('2026', 'businessCombined')).notes).toEqual(['resultPositive']);
    const statement = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(statement.spheres.filter((x) => x.sphere === 'business' || x.sphere === 'purposeOperation').reduce((sum, x) => sum + x.resultCents, 0)).toBe(1);
  });

  it('counts small business turnover per calendar year (Joe-Frage 2)', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2025-07-01', endsOn: '2026-06-30' }));
    const sales = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'sales')).get()!;
    const book = (date: string, cents: number) => bookEntry(deps, ctx, { entryDate: date, text: 'Verkauf', moneyLines: [{ accountId: bank.id, amountCents: cents }], allocationLines: [{ categoryId: sales.id, amountCents: cents, taxCode: 'standard' }] }).then(unwrap);
    await book('2025-11-15', 2000000);
    await book('2026-02-15', 1000000);
    const next = deps.db.transaction((tx) => ensureFiscalYearFor(tx, deps, ctx, '2026-08-01'));
    if (!next.ok) throw new Error('kein Folgejahr');
    const views = unwrap(await getThresholds(deps, ctx, { fiscalYearId: next.value.id }));
    expect(views.find((t) => t.key === 'smallBusinessPrevYear')).toMatchObject({ valueCents: 2000000 });
  });
});
