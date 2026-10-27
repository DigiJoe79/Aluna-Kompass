import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { incomeStatement } from '../src/ledger/queries';
import { computeIncomeStatementReport, incomeStatementTypst } from '../src/reporting/reports/income-statement';
import { previewFinanceReport } from '../src/reporting/finalize';
import { runFinanceReport } from '../src/reporting/service';
import { financeCategories } from '../src/schema';
import { ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const category = (f: Fixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
const book = (f: Fixture, date: string, key: string, cents: number) =>
  bookEntry(f.deps, f.ctx, { entryDate: date, text: key, moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: category(f, key).id, amountCents: cents, taxCode: 'none' }] }).then(unwrap);
const names = (f: Fixture) => ({ categoryNames: Object.fromEntries(f.deps.db.select().from(financeCategories).all().map((c) => [c.id, c.name])), accountNames: {}, labels: {} });

async function twoYears() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const y2026 = f.years['2026']!.id;
  await book(f, '2025-05-01', 'donations', 20000);
  await book(f, '2025-06-01', 'program-costs', -5000);
  await book(f, '2026-03-01', 'donations', 30000);
  await book(f, '2026-03-02', 'office', -1200);
  await book(f, '2026-03-03', 'interest', 300);
  return { f, y2025, y2026 };
}

describe('Bericht incomeStatement (Rechenschaft A2 Task 2)', () => {
  it('sums like incomeStatement and carries the previous year', async () => {
    const { f, y2025, y2026 } = await twoYears();
    const data = computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2026 });
    const plain = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect([data.totalIncomeCents, data.totalExpenseCents, data.resultCents]).toEqual([plain.totalIncomeCents, plain.totalExpenseCents, plain.resultCents]);
    expect(data.previous).toMatchObject({ id: y2025, designation: '2025' });
    const ideal = data.spheres.find((s) => s.sphere === 'ideal')!;
    expect(ideal).toMatchObject({ incomeCents: 30000, expenseCents: 1200, resultCents: 28800, previousResultCents: 15000 });
    // Eine Kategorie nur im Vorjahr steht mit 0 im Jahr da, damit der Vergleich vollständig ist.
    expect(ideal.categories.find((c) => c.categoryId === category(f, 'program-costs').id)).toMatchObject({ sumCents: 0, previousSumCents: -5000 });
    expect(data.spheres.find((s) => s.sphere === 'assetManagement')).toMatchObject({ resultCents: 300, previousResultCents: 0 });
  });

  it('has no previous year in the first year — the column is left out, not zero', async () => {
    const { f, y2025 } = await twoYears();
    const data = computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2025 });
    expect(data.previous).toBeNull();
    expect(data.spheres.every((s) => s.previousResultCents === null && s.categories.every((c) => c.previousSumCents === null))).toBe(true);
    const typst = incomeStatementTypst(data, names(f));
    expect(data.previousTotals).toBeNull();
    expect(typst).not.toContain('2024');
    for (const c of data.spheres.flatMap((s) => s.categories)) expect(typst).toContain(names(f).categoryNames[c.categoryId]!);
  });

  it('names the columns after the year and its previous year, in every table, also in „Gesamt“ (Designer Runde 7, 247)', async () => {
    const { f, y2026 } = await twoYears();
    const data = computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2026 });
    const prior = incomeStatement(f.deps.db, { from: '2025-01-01', to: '2025-12-31' });
    expect(data.previousTotals).toEqual({ incomeCents: prior.totalIncomeCents, expenseCents: prior.totalExpenseCents, resultCents: prior.resultCents });
    const typst = incomeStatementTypst(data, names(f));
    const heads = typst.split('\n').filter((l) => l.includes('table.header'));
    expect(heads.length).toBeGreaterThan(1);
    for (const h of heads) expect(h).toMatch(/2026.*2025/);
    expect(typst).not.toMatch(/"Jahr"|"Vorjahr"/);
    // Die Gesamttabelle bricht nicht um.
    expect(typst).toMatch(/#block\(breakable: false\)\[\s*== #"Gesamt"/);
  });

  it('allows combining purpose operation and business only from 2026, under the limit and with a profit', async () => {
    const { f, y2025, y2026 } = await twoYears();
    await book(f, '2025-07-01', 'sales', 4000);
    await book(f, '2026-04-01', 'sales', 4000);
    await book(f, '2026-04-02', 'purpose-income', 1000);
    expect(computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2025 }).combineAllowed).toBe(false);
    const allowed = computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2026, combineOperations: true });
    expect(allowed).toMatchObject({ combineAllowed: true, combined: true });
    expect(computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2026 }).combined).toBe(false);
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'incomeStatement', params: { fiscalYearId: y2025, combineOperations: true } }))).toMatchObject({ type: 'validation', issues: [{ path: 'combineOperations', message: 'combineNotAllowed' }] });

    await book(f, '2026-04-03', 'business-costs', -6000);
    expect(computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2026 }).combineAllowed).toBe(false);
  });

  it('warns about a loss in the business, never about one in the purpose operation', async () => {
    const { f, y2026 } = await twoYears();
    await book(f, '2026-05-01', 'purpose-costs', -800);
    expect(computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2026 }).warnings).toEqual([]);
    await book(f, '2026-05-02', 'business-costs', -900);
    await book(f, '2026-05-03', 'asset-costs', -500);
    expect(computeIncomeStatementReport(f.deps.db, { fiscalYearId: y2026 }).warnings).toEqual(['businessLoss', 'assetManagementLoss']);
  });

  it('runs and renders through the catalogue', async () => {
    const { f, y2026 } = await twoYears();
    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'incomeStatement', params: { fiscalYearId: y2026 } }));
    expect(run.stage).toBe('preliminary');
    expect(run.lines?.['ideal.income']).toMatchObject({ count: 1 });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'incomeStatement', params: { fiscalYearId: 'unknown' } }))).toMatchObject({ type: 'notFound' });
    const preview = unwrap(await previewFinanceReport(f.deps, f.ctx, { report: 'incomeStatement', params: { fiscalYearId: y2026, combineOperations: false } }));
    expect(new TextDecoder().decode(preview.bytes.subarray(0, 5))).toBe('%PDF-');
  });
});
