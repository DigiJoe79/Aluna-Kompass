import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCategory } from '../src/ledger/categories';
import { bookEntry } from '../src/ledger/finalize';
import { annualRevenueForGemInternal, operationsRevenueInternal } from '../src/reporting/revenue';
import { thresholdsInternal } from '../src/closing/thresholds';
import { vatReturnRequiredInternal } from '../src/ledger/vat-periods';
import { financeCategories, financeFiscalYears } from '../src/schema';
import { ledgerFixture } from './helpers';

async function setup() {
  const f = await ledgerFixture({ years: ['2025', '2026'], entrepreneur: true });
  const cat = (key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
  const book = (date: string, key: string, cents: number, line: Record<string, unknown> = {}) =>
    bookEntry(f.deps, f.ctx, { entryDate: date, text: key, moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: cat(key).id, amountCents: cents, ...line }] }).then(unwrap);
  unwrap(await createCategory(f.deps, f.ctx, { key: 'asset-sale', name: 'Verkauf Anlagegut', direction: 'income', sphere: 'assetManagement', incomeKind: 'other', isAssetSale: true }));
  return { f, y2025: f.years['2025']!.id, book };
}

describe('annualRevenueForGemInternal (Einnahmen nach § 55, Anlage Gem Zeile 9)', () => {
  it('counts all finalized income of the year by entry date, with in-kind and additions to assets, without asset sales, tax refunds and transit; returns reduce', async () => {
    const { f, y2025, book } = await setup();
    await book('2025-02-01', 'donations', 10000);
    await book('2025-02-02', 'inheritances', 50000, { addsToAssets: true });
    await book('2025-02-03', 'in-kind-donations', 3000);
    await book('2025-02-04', 'sales', 11900, { taxCode: 'standard' });
    await book('2025-02-05', 'donations', -2000);
    await book('2025-02-06', 'asset-sale', 70000);
    await book('2025-02-07', 'vat-refund', 900);
    await book('2025-02-08', 'not-ours', 4000);
    await book('2026-01-02', 'donations', 99900);
    const revenue = annualRevenueForGemInternal(f.deps.db, y2025);
    const part = (key: string) => revenue.parts.find((p) => p.key === key)!;
    expect(part('income')).toEqual({ key: 'income', cents: 21900, included: true });
    expect(part('inKind')).toEqual({ key: 'inKind', cents: 3000, included: true });
    expect(part('expenseWaiver')).toEqual({ key: 'expenseWaiver', cents: 0, included: true });
    expect(part('addsToAssets')).toEqual({ key: 'addsToAssets', cents: 50000, included: true });
    expect(part('returns')).toEqual({ key: 'returns', cents: -2000, included: true });
    expect(part('assetSales')).toEqual({ key: 'assetSales', cents: 70000, included: false });
    expect(part('taxRefunds')).toEqual({ key: 'taxRefunds', cents: 900, included: false });
    expect(part('transit')).toEqual({ key: 'transit', cents: 4000, included: false });
    expect(revenue.totalCents).toBe(21900 + 3000 + 50000 - 2000);
  });

  it('shows expense waivers as a part of their own — counted, the other reading stays visible (Joe 2026-10-25)', async () => {
    const { f, y2025, book } = await setup();
    await book('2025-03-01', 'expense-waivers', 4500);
    await book('2025-03-02', 'in-kind-donations', 1000);
    const revenue = annualRevenueForGemInternal(f.deps.db, y2025);
    expect(revenue.parts.find((p) => p.key === 'expenseWaiver')).toEqual({ key: 'expenseWaiver', cents: 4500, included: true });
    expect(revenue.parts.find((p) => p.key === 'inKind')).toEqual({ key: 'inKind', cents: 1000, included: true });
    expect(revenue.totalCents).toBe(5500);
  });
});

describe('operationsRevenueInternal (Einnahmen der Betriebe, Schwellenwächter und Anlage Gem Zeile 10)', () => {
  it('counts the spheres asked for, gross, without transit, asset sales and threshold exclusions — like the threshold guard', async () => {
    const { f, y2025, book } = await setup();
    unwrap(await createCategory(f.deps, f.ctx, { key: 'business-grant', name: 'Zuschuss Betrieb', direction: 'income', sphere: 'business', incomeKind: 'other', thresholdExclusion: 'notPerformance' }));
    unwrap(await createCategory(f.deps, f.ctx, { key: 'business-asset-sale', name: 'Verkauf Inventar Betrieb', direction: 'income', sphere: 'business', incomeKind: 'other', isAssetSale: true }));
    await book('2025-04-01', 'sales', 11900, { taxCode: 'standard' });
    await book('2025-04-02', 'purpose-income', 5350, { taxCode: 'reduced' });
    await book('2025-04-03', 'business-grant', 20000);
    await book('2025-04-04', 'business-asset-sale', 30000);
    await book('2025-04-05', 'vat-refund', 900);
    await book('2025-04-06', 'not-ours', 4000);
    await book('2025-04-07', 'sales', -1900, { taxCode: 'standard' });
    expect(operationsRevenueInternal(f.deps.db, y2025, ['business'])).toBe(10000);
    expect(operationsRevenueInternal(f.deps.db, y2025, ['business', 'purposeOperation'])).toBe(15350);
    const year = f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, y2025)).get()!;
    const thresholds = thresholdsInternal(f.deps, f.ctx, year);
    expect(thresholds.find((t) => t.key === 'business')!.valueCents).toBe(10000);
    expect(thresholds.find((t) => t.key === 'businessCombined')!.valueCents).toBe(15350);
    // Zeile 9 nimmt den Zuschuss (nicht leistungsbezogen) mit, Zeile 10 nicht (Recherche 2026-10-25, Frage 4).
    expect(annualRevenueForGemInternal(f.deps.db, y2025).totalCents).toBe(11900 + 5350 + 20000 - 1900);
  });

  it('knows whether a year needs an annual VAT return under section 18 (4a) UStG', async () => {
    const { f, y2025, book } = await setup();
    expect(vatReturnRequiredInternal(f.deps.db, 2025)).toBe(false);
    await book('2025-05-01', 'it', -11900, { taxCode: 'rc13bEu' });
    expect(vatReturnRequiredInternal(f.deps.db, 2025)).toBe(true);
    // Hinweis der Steuererklärung und Frist unter „Fristen und Schwellen“ aus derselben Quelle (Designer Runde 7, 16d/307).
    const { listFinanceDeadlines } = await import('../src/closing/deadlines');
    const { createTaxPeriod, getTaxReturn } = await import('../src/index');
    const deadline = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.find((d) => d.kind === 'vatReturn');
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2025, lastFiscalYearId: y2025, withTaxAdvisor: false, dueOn: '2026-07-31' }));
    const data = unwrap(await getTaxReturn(f.deps, f.ctx, { taxPeriodId: period.id })).run.data as { hints: { code: string; dueOn?: string; year?: number }[] };
    const hint = data.hints.find((h) => h.code === 'vatReturnRequired');
    // Kalenderjahr 2025, Frist 31.07.2026 (Freitag, ein Werktag).
    expect(hint).toMatchObject({ year: 2025, dueOn: '2026-07-31' });
    expect(hint?.dueOn).toBe(deadline?.dueOn);
  });
});
