import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { personYearOverview } from '../src/allocation/people';
import { bookEntry } from '../src/ledger/finalize';
import { renderContextInternal } from '../src/reporting/finalize';
import { peopleOverviewReport, peopleOverviewTypst, type PeopleOverviewReport } from '../src/reporting/reports/people-overview';
import { runFinanceReport } from '../src/reporting/service';
import { financeCategories } from '../src/schema';
import { expenseFixture, type ExpenseFixture } from './expense-fixture';

const category = (f: ExpenseFixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
const allowance = (f: ExpenseFixture, cents: number, contactId?: string) =>
  bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Ehrenamtspauschale', moneyLines: [{ accountId: f.bank.id, amountCents: -cents }], allocationLines: [{ categoryId: category(f, 'volunteer-allowance').id, amountCents: -cents, ...(contactId ? { contactId } : {}) }] }).then(unwrap);
const run = async (f: ExpenseFixture) => unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'peopleOverview', params: { fiscalYearId: f.year.id } })).data as PeopleOverviewReport;

describe('Bericht peopleOverview (Rechenschaft B1 Task 7)', () => {
  it('equals the person overview of the calendar year of the year end', async () => {
    const f = await expenseFixture();
    await allowance(f, 50000, f.hanna.contactId);
    const data = await run(f);
    expect(data.calendarYear).toBe(2026);
    expect({ rows: data.rows, linesWithoutPersonCount: data.linesWithoutPersonCount }).toEqual(unwrap(await personYearOverview(f.deps, f.ctx, { year: 2026 })));
    expect(data.warnings).toEqual([]);
    expect(peopleOverviewReport.paperPeriod!(data)).toBe('Kalenderjahr 2026');
  });

  it('warns about an exceeded allowance and lines without a person', async () => {
    const f = await expenseFixture();
    await allowance(f, 100000, f.hanna.contactId);
    await allowance(f, 5000);
    const data = await run(f);
    expect(data.warnings).toEqual(['allowanceExceeded', 'linesWithoutPerson']);
    const typst = peopleOverviewTypst(data, renderContextInternal(f.deps));
    expect(typst).toContain('960,00');
    expect(typst).toContain('40,00');
  });
});
