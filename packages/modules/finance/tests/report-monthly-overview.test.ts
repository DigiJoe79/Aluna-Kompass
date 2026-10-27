import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { bookEntry } from '../src/ledger/finalize';
import { incomeStatement } from '../src/ledger/queries';
import { renderContextInternal } from '../src/reporting/finalize';
import { computeMonthlyOverviewReport, monthlyOverviewReport, monthlyOverviewTypst } from '../src/reporting/reports/monthly-overview';
import { ledgerFixture, setupFinance } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const book = (f: Fixture, date: string, cents: number, categoryId: string) =>
  bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Monat', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId, amountCents: cents, taxCode: 'none' }] }).then(unwrap);

describe('Bericht monthlyOverview (Rechenschaft B1, Antwort Joe 1)', () => {
  it('sums per category and month and equals the income statement in total', async () => {
    const f = await ledgerFixture();
    await book(f, '2026-01-15', 5000, f.donations.id);
    await book(f, '2026-01-20', 2500, f.donations.id);
    await book(f, '2026-03-02', -1200, f.programCosts.id);
    await book(f, '2026-03-03', -300, f.fees.id);
    const data = computeMonthlyOverviewReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    const donations = data.categories.find((c) => c.categoryId === f.donations.id)!;
    expect(donations.perMonth[0]).toBe(7500);
    expect(donations.totalCents).toBe(7500);
    expect(data.categories.find((c) => c.categoryId === f.programCosts.id)!.perMonth[2]).toBe(1200);
    for (const c of data.categories) expect(c.perMonth.reduce((s, v) => s + v, 0)).toBe(c.totalCents);
    data.months.forEach((_m, i) => expect(data.incomePerMonth[i]! - data.expensePerMonth[i]!).toBe(data.resultPerMonth[i]));
    const eur = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(data.totals).toEqual({ incomeCents: eur.totalIncomeCents, expenseCents: eur.totalExpenseCents, resultCents: eur.resultCents });
    expect(monthlyOverviewTypst(data, renderContextInternal(f.deps))).toContain('Summe');
  });

  it('shows only the months of a short year', async () => {
    const { deps, ctx } = setupFinance();
    const year = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-09-01', endsOn: '2026-12-31' }));
    expect(computeMonthlyOverviewReport(deps.db, { fiscalYearId: year.id }).months.map((m) => [m.from, m.to])).toEqual([
      ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31'],
    ]);
  });

  it('names lines per category and month', async () => {
    const f = await ledgerFixture();
    await book(f, '2026-02-10', 5000, f.donations.id);
    const data = computeMonthlyOverviewReport(f.deps.db, { fiscalYearId: f.year.id });
    expect(monthlyOverviewReport.linesFilter!(data, { fiscalYearId: f.year.id })[`${f.donations.id}.2026-02`]).toEqual({ fiscalYearId: f.year.id, categoryId: f.donations.id, from: '2026-02-01', to: '2026-02-28' });
  });
});
