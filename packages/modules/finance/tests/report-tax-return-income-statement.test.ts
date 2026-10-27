import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { incomeStatement } from '../src/ledger/queries';
import { createTaxPeriod, saveTaxPeriodAnswers } from '../src/ledger/tax-periods';
import { taxReturnIncomeStatementTypst, type TaxReturnIncomeStatementReport } from '../src/reporting/reports/tax-return-income-statement';
import { runFinanceReport } from '../src/reporting/service';
import { financeCategories } from '../src/schema';
import { ledgerFixture } from './helpers';
import { ctxWith } from '@kompass/core/testing';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('Bericht taxReturnIncomeStatement — EÜR für das Finanzamt (Rechenschaft D2 Task 6)', () => {
  async function setup() {
    const f = await ledgerFixture({ years: ['2024', '2025'] });
    const y = (d: string) => f.years[d]!.id;
    const cat = (key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!.id;
    const book = (date: string, key: string, cents: number, line: Record<string, unknown> = {}) =>
      bookEntry(f.deps, f.ctx, { entryDate: date, text: key, moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: cat(key), amountCents: cents, ...line }] }).then(unwrap);
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2024'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    return { f, y, cat, book, period };
  }

  it('sums the posts per sphere and year like the income statement, rent under rent, grants of other bodies under grants', async () => {
    const { f, y, book, period } = await setup();
    const contactCtx = { ...f.ctx, permissions: new Set(['contacts.manage']) };
    const anna = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Anna', lastName: 'Übung' }));
    const ben = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Ben', lastName: 'Übung' }));
    await book('2025-01-10', 'membership-fees', 1000);
    await book('2025-01-11', 'donations', 2000);
    await book('2025-01-12', 'in-kind-donations', 500);
    await book('2025-01-13', 'expense-waivers', 300);
    await book('2025-01-14', 'body-grants', 3000);
    await book('2025-01-15', 'platform-payouts', 400);
    await book('2025-01-16', 'public-grants', 1000);
    await book('2025-01-17', 'court-fines', 100);
    await book('2025-01-18', 'inheritances', 10000);
    await book('2025-01-19', 'interest', 50);
    await book('2025-01-20', 'rent', 1200);
    await book('2025-01-21', 'purpose-income', 800, { taxCode: 'reduced' });
    await book('2025-01-22', 'sales', 900, { taxCode: 'standard' });
    await book('2025-01-23', 'events', 100, { taxCode: 'standard' });
    await book('2025-01-24', 'sponsoring', 700, { taxCode: 'standard' });
    await book('2025-01-25', 'program-costs', -400);
    await book('2025-01-26', 'business-costs', -300);
    await book('2025-01-27', 'not-ours', 999);
    await book('2025-02-01', 'trainer-allowance', -60000, { contactId: anna.id });
    await book('2025-02-02', 'trainer-allowance', -60000, { contactId: ben.id });
    await book('2024-03-01', 'donations', 777);
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: { memberCounts: { [y('2025')]: 42 } } }));

    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnIncomeStatement', params: { taxPeriodId: period.id } }));
    const data = run.data as TaxReturnIncomeStatementReport;
    expect(data.years.map((yr) => yr.designation)).toEqual(['2024', '2025']);
    const year = data.perYear.find((p) => p.fiscalYearId === y('2025'))!;
    const sphere = (key: string) => year.spheres.find((s) => s.sphere === key)!;
    const post = (key: string, name: string) => sphere(key).income.find((p) => p.post === name)!.cents;
    expect(post('ideal', 'membershipFees')).toBe(1000);
    expect(post('ideal', 'donations')).toBe(2800);
    expect(post('ideal', 'grants')).toBe(4400);
    expect(post('ideal', 'otherIdeal')).toBe(10100);
    expect(post('assetManagement', 'interest')).toBe(50);
    expect(post('assetManagement', 'rent')).toBe(1200);
    expect(post('purposeOperation', 'fees')).toBe(800);
    expect(post('business', 'sales')).toBe(1000);
    expect(post('business', 'sponsoring')).toBe(700);
    // Gegenprobe: Summe der Posten = Einnahmen des Bereichs der EÜR; durchlaufende Gelder zählen nie.
    const statement = incomeStatement(f.deps.db, { from: '2025-01-01', to: '2025-12-31' });
    for (const s of statement.spheres) {
      expect(sphere(s.sphere).incomeCents).toBe(s.incomeCents);
      expect(sphere(s.sphere).income.reduce((sum, p) => sum + p.cents, 0)).toBe(s.incomeCents);
      expect(sphere(s.sphere).expenseCents).toBe(s.expenseCents);
      expect(sphere(s.sphere).resultCents).toBe(s.resultCents);
    }
    expect(year.trainer).toEqual({ persons: 2, cents: 120000 });
    expect(year.memberCount).toBe(42);
    expect(data.perYear.find((p) => p.fiscalYearId === y('2024'))!.memberCount).toBeNull();
    expect(post === undefined).toBe(false);
  });

  it('puts every count of the memo table into the column of its year, right-aligned like the amounts (Befund 18a)', async () => {
    const { f, y, period } = await setup();
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: { memberCounts: { [y('2024')]: 7, [y('2025')]: 42 } } }));
    const data = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnIncomeStatement', params: { taxPeriodId: period.id } })).data as TaxReturnIncomeStatementReport;
    const typst = taxReturnIncomeStatementTypst(data);
    const memo = typst.slice(typst.indexOf('Nachrichtlich'));
    const rows = memo.split('\n').filter((line) => line.startsWith('  [') && !line.includes('table.header'));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      // Nach der Bezeichnung genau eine Zelle je Jahr, jede rechtsbündig in ihrer Spalte.
      const cells = row.trim().replace(/,$/, '').split(/, (?=table\.cell|\[)/);
      expect(cells).toHaveLength(1 + data.years.length);
      for (const cell of cells.slice(1)) expect(cell).toMatch(/^table\.cell\(align: right\)/);
    }
  });

  it('follows the period of a year on the reports page, needs finance.overview only', async () => {
    const { f, period } = await setup();
    expect(err(await runFinanceReport(f.deps, ctxWith(['finance.overview'], f.userId), { report: 'taxReturnIncomeStatement', params: { taxPeriodId: period.id } }))).toBe('ok');
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnIncomeStatement', params: { taxPeriodId: 'NOPE' } }))).toMatchObject({ type: 'notFound' });
  });
});
