import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { installFinance } from '../src/install';
import { createAccount } from '../src/ledger/accounts';
import { setDatedValue } from '../src/ledger/dated-values';
import { bookEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { reverseEntry } from '../src/ledger/reverse';
import { createTaxPeriod } from '../src/ledger/tax-periods';
import { saveVatSettings } from '../src/ledger/vat-settings';
import { parseVatPeriod, vatAdvancePeriodsInternal, vatPeriodDigestInternal, vatPeriodOf, vatReturnDueOnInternal, vatReturnRequiredInternal, vatTaxPointOn } from '../src/ledger/vat-periods';
import { financeCategories } from '../src/schema';
import { ledgerFixture, setupFinance } from './helpers';

type F = Awaited<ReturnType<typeof ledgerFixture>>;
const categoryId = (f: Pick<F, 'deps'>, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!.id;

const book = (f: Pick<F, 'deps' | 'ctx'> & { bankId: string }, opts: { date: string; cents: number; taxCode: string; serviceDate?: string; category?: string }) =>
  bookEntry(f.deps, f.ctx, {
    entryDate: opts.date,
    text: 'Buchung',
    moneyLines: [{ accountId: f.bankId, amountCents: opts.cents }],
    allocationLines: [{ categoryId: categoryId(f, opts.category ?? (opts.cents < 0 ? 'fundraising' : 'sales')), amountCents: opts.cents, taxCode: opts.taxCode, ...(opts.serviceDate ? { serviceDate: opts.serviceDate } : {}) }],
  }).then(unwrap);

async function fixture(years: string[] = ['2025', '2026']) {
  const f = await ledgerFixture({ years, entrepreneur: true });
  return { ...f, bankId: f.bank.id };
}

const byKey = (periods: { key: string }[]) => Object.fromEntries(periods.map((p) => [p.key, p])) as Record<string, ReturnType<typeof vatAdvancePeriodsInternal>[number]>;

/** Plan E6a Task 4 — Voranmeldungszeiträume nach Entstehung, Jahreserklärung nach Kalenderjahr. */
describe('VAT periods', () => {
  it('takes the tax point from the service date', () => {
    expect(vatTaxPointOn({ taxCode: 'rc13bEu', entryDate: '2026-04-10', serviceDate: '2026-03-20' })).toBe('2026-03-20');
    expect(vatTaxPointOn({ taxCode: 'rc13bEu', entryDate: '2026-06-15', serviceDate: '2026-07-01' })).toBe('2026-06-15');
    expect(vatTaxPointOn({ taxCode: 'rc13bOther', entryDate: '2026-06-15', serviceDate: null })).toBe('2026-06-15');
    expect(vatTaxPointOn({ taxCode: 'standard', entryDate: '2026-06-15', serviceDate: '2026-05-01' })).toBe('2026-06-15');
  });

  it('builds period keys', () => {
    expect(vatPeriodOf('2026-05-12', 'quarter')).toEqual({ key: '2026-Q2', kind: 'quarter', startsOn: '2026-04-01', endsOn: '2026-06-30' });
    expect(vatPeriodOf('2026-05-12', 'month')).toEqual({ key: '2026-05', kind: 'month', startsOn: '2026-05-01', endsOn: '2026-05-31' });
    expect(parseVatPeriod('2026-Q5')).toBeNull();
    expect(parseVatPeriod('2026-13')).toBeNull();
    expect(parseVatPeriod('2026')).toEqual({ key: '2026', kind: 'year', startsOn: '2026-01-01', endsOn: '2026-12-31' });
    expect(parseVatPeriod('2026-02')).toEqual({ key: '2026-02', kind: 'month', startsOn: '2026-02-01', endsOn: '2026-02-28' });
  });

  it('requires an advance return only for reverse-charge periods of a small business', async () => {
    const f = await fixture();
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2025-01-01', vatEntrepreneur: true }));
    expect(vatAdvancePeriodsInternal(f.deps.db, 2026, '2026-10-25').filter((p) => p.required)).toEqual([]);
    const entry = await book(f, { date: '2026-05-12', cents: -20000, taxCode: 'rc13bEu' });
    const periods = byKey(vatAdvancePeriodsInternal(f.deps.db, 2026, '2026-10-25'));
    expect(Object.keys(periods)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
    expect(periods['2026-Q2']).toMatchObject({ required: true, reason: 'section18_4a', dueOn: '2026-07-10' });
    expect(periods['2026-Q2']!.amounts.rc13bEu).toEqual({ baseCents: 20000, taxCents: 3800 });
    expect(periods['2026-Q1']!.required || periods['2026-Q3']!.required || periods['2026-Q4']!.required).toBe(false);
    f.deps.clock.set('2026-06-20T10:00:00.000Z');
    unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    expect(byKey(vatAdvancePeriodsInternal(f.deps.db, 2026, '2026-10-25'))['2026-Q2']!.required).toBe(false);
  });

  it('requires every period under regular taxation unless exempt', async () => {
    const f = await fixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'regular' }));
    const periods = vatAdvancePeriodsInternal(f.deps.db, 2026, '2026-10-25');
    expect(periods.map((p) => [p.key, p.required, p.reason])).toEqual([['2026-Q1', true, 'regular'], ['2026-Q2', true, 'regular'], ['2026-Q3', true, 'regular'], ['2026-Q4', true, 'regular']]);
    expect(periods[2]!.dueOn).toBe('2026-10-12');
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-01-01', vatAdvanceExempt: true }));
    expect(vatAdvancePeriodsInternal(f.deps.db, 2026, '2026-10-25').filter((p) => p.required)).toEqual([]);
    expect(vatReturnRequiredInternal(f.deps.db, 2026)).toBe(true);
  });

  it('extends the deadline by one month', async () => {
    const f = await fixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'regular' }));
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-01-01', vatPermanentExtension: true }));
    const periods = byKey(vatAdvancePeriodsInternal(f.deps.db, 2026, '2026-10-25'));
    expect(periods['2026-Q2']!.dueOn).toBe('2026-08-10');
    expect(periods['2026-Q3']!.dueOn).toBe('2026-11-10');
  });

  it('switches to months above 9,000 € tax in the previous year', async () => {
    const f = await fixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2025-01-01', value: 'regular' }));
    await book(f, { date: '2025-03-01', cents: 5950000, taxCode: 'standard' });
    const months = vatAdvancePeriodsInternal(f.deps.db, 2026, '2026-12-31');
    expect(months.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-01-01', vatAdvancePeriod: 'quarter' }));
    expect(vatAdvancePeriodsInternal(f.deps.db, 2026, '2026-12-31').map((p) => p.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
    const g = await fixture();
    unwrap(await setDatedValue(g.deps, g.ctx, { key: 'taxation', validFrom: '2025-01-01', value: 'regular' }));
    await book(g, { date: '2025-03-01', cents: 5355000, taxCode: 'standard' });
    expect(vatAdvancePeriodsInternal(g.deps.db, 2026, '2026-12-31')).toHaveLength(4);
  });

  it('assigns a December service booked in January to the old year', async () => {
    const f = await fixture(['2026', '2027']);
    f.deps.clock.set('2027-02-01T10:00:00.000Z');
    await book(f, { date: '2027-01-12', cents: -4900, taxCode: 'rc13bOther', serviceDate: '2026-12-15' });
    expect(byKey(vatAdvancePeriodsInternal(f.deps.db, 2026, '2027-02-01'))['2026-Q4']).toMatchObject({ required: true, reason: 'section18_4a' });
    expect(vatReturnRequiredInternal(f.deps.db, 2026)).toBe(true);
    expect(vatReturnRequiredInternal(f.deps.db, 2027)).toBe(false);
  });

  it('follows the calendar year for the annual return', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const year = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2025-07-01', endsOn: '2026-06-30' }));
    await book({ deps, ctx, bankId: bank.id }, { date: '2025-11-15', cents: -4900, taxCode: 'rc13bOther' });
    expect(vatReturnRequiredInternal(deps.db, 2025)).toBe(true);
    expect(vatReturnRequiredInternal(deps.db, 2026)).toBe(false);
    expect(vatReturnDueOnInternal(deps.db, 2025)).toBe('2026-07-31');
    unwrap(await createTaxPeriod(deps, ctx, { firstFiscalYearId: year.id, lastFiscalYearId: year.id, withTaxAdvisor: true, dueOn: '2028-02-29' }));
    expect(vatReturnDueOnInternal(deps.db, 2025)).toBe('2027-03-01');
  });

  it('changes the digest only with the period lines', async () => {
    const f = await fixture();
    await book(f, { date: '2026-05-12', cents: -20000, taxCode: 'rc13bEu' });
    const before = vatPeriodDigestInternal(f.deps.db, '2026-Q2');
    await book(f, { date: '2026-07-20', cents: -1000, taxCode: 'rc13bEu' });
    expect(vatPeriodDigestInternal(f.deps.db, '2026-Q2')).toBe(before);
    await book(f, { date: '2026-07-20', cents: -1000, taxCode: 'rc13bEu', serviceDate: '2026-05-30' });
    expect(vatPeriodDigestInternal(f.deps.db, '2026-Q2')).not.toBe(before);
  });
});
