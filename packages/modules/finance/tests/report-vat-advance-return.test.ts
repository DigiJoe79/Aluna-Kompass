import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setDatedValue } from '../src/ledger/dated-values';
import { bookEntry } from '../src/ledger/finalize';
import { finalizeFinanceReport } from '../src/reporting/finalize';
import { reportsReopenGuard } from '../src/reporting/locks';
import { vatAdvanceReturnReport, type VatAdvanceReturnData } from '../src/reporting/reports/vat-advance-return';
import { runFinanceReport } from '../src/reporting/service';
import { financeCategories } from '../src/schema';
import { ledgerFixture } from './helpers';

type F = Awaited<ReturnType<typeof ledgerFixture>>;
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { type: string; code?: string; issues?: { path: string; message: string }[] }));

async function fixture(opts: { regular?: boolean; entrepreneur?: boolean } = {}) {
  const f = await ledgerFixture();
  f.deps.clock.set('2026-10-25T09:00:00.000Z');
  if (opts.entrepreneur !== false) unwrap(await setDatedValue(f.deps, f.ctx, { key: 'vatEntrepreneur', validFrom: '2026-01-01', value: true }));
  if (opts.regular) unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'regular' }));
  return f;
}

const category = (f: F, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
const deductible = (f: F, key: string) => {
  f.deps.db.update(financeCategories).set({ inputTaxDeductible: 'yes' }).where(eq(financeCategories.key, key)).run();
  return category(f, key);
};

const book = (f: F, o: { date: string; cents: number; taxCode: string; categoryId?: string; serviceDate?: string }) =>
  bookEntry(f.deps, f.ctx, { entryDate: o.date, text: 'Buchung', moneyLines: [{ accountId: f.bank.id, amountCents: o.cents }], allocationLines: [{ categoryId: o.categoryId ?? f.programCosts.id, amountCents: o.cents, taxCode: o.taxCode, ...(o.serviceDate ? { serviceDate: o.serviceDate } : {}) }] }).then(unwrap);

const run = async (f: F, vatPeriod: string) => unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod } }));
const values = (data: unknown) => Object.fromEntries((data as VatAdvanceReturnData).values.map((v) => [v.source, v.cents]));
const typst = (data: unknown) => vatAdvanceReturnReport.toTypst(data as VatAdvanceReturnData, { categoryNames: {}, accountNames: {}, labels: {} });

/** Plan E6b Task 5 — Bericht `vatAdvanceReturn`. */
describe('VAT advance return', () => {
  it('fills 46/47 for a small business', async () => {
    const f = await fixture();
    await book(f, { date: '2026-05-12', cents: -20000, taxCode: 'rc13bEu' });
    const data = (await run(f, '2026-Q2')).data;
    expect(values(data)).toMatchObject({ rc13bEuBase: 20000, rc13bEuTax: 3800, result: 3800, inputTax: 0, inputTaxReverseCharge: 0, inputTaxAcquisition: 0 });
    const body = typst(data);
    expect(body).toMatch(/"46";\][^\n]*\[200\]/);
    expect(body).toMatch(/"47";\][^\n]*\[38,00\]/);
    expect(body).toMatch(/"83";\][^\n]*\[38,00\]/);
  });

  it('cuts cents from the base, not from the tax', async () => {
    const f = await fixture();
    await book(f, { date: '2026-05-12', cents: -20099, taxCode: 'rc13bEu' });
    const body = typst((await run(f, '2026-Q2')).data);
    expect(body).toMatch(/"46";\][^\n]*\[200\]/);
    expect(body).toMatch(/"47";\][^\n]*\[38,19\]/);
  });

  it('adds 84/85 and the service date', async () => {
    const f = await fixture();
    await book(f, { date: '2026-05-12', cents: -20000, taxCode: 'rc13bEu' });
    await book(f, { date: '2026-07-03', cents: -6000, taxCode: 'rc13bOther', serviceDate: '2026-06-30' });
    expect(values((await run(f, '2026-Q2')).data)).toMatchObject({ rc13bOtherBase: 6000, rc13bOtherTax: 1140, result: 4940 });
    expect(values((await run(f, '2026-Q3')).data)).toMatchObject({ rc13bOtherBase: 0, result: 0 });
  });

  it('computes regular returns with input tax', async () => {
    const f = await fixture({ regular: true });
    const costs = deductible(f, 'business-costs');
    await book(f, { date: '2026-05-02', cents: 119000, taxCode: 'standard', categoryId: category(f, 'sales').id });
    await book(f, { date: '2026-05-03', cents: -11900, taxCode: 'standard', categoryId: costs.id });
    await book(f, { date: '2026-05-04', cents: -10000, taxCode: 'rc13bEu', categoryId: costs.id });
    const data = (await run(f, '2026-Q2')).data;
    expect(values(data)).toMatchObject({ ownStandardBase: 100000, inputTax: 1900, rc13bEuBase: 10000, rc13bEuTax: 1900, inputTaxReverseCharge: 1900, result: 17100 });
    const body = typst(data);
    expect(body).toMatch(/"81";\][^\n]*\[1\.000\]/);
    expect(body).toMatch(/"66";\][^\n]*\[19,00\]/);
    expect(body).toMatch(/"67";\][^\n]*\[19,00\]/);
    const g = await fixture({ regular: true });
    await book(g, { date: '2026-05-03', cents: -11900, taxCode: 'standard', categoryId: deductible(g, 'business-costs').id });
    expect(values((await run(g, '2026-Q2')).data).result).toBe(-1900);
  });

  it('shows 48 only with own turnover of a small business', async () => {
    const f = await fixture();
    const income = await book(f, { date: '2026-05-02', cents: 30000, taxCode: 'reduced', categoryId: f.purposeIncome.id });
    const data = (await run(f, '2026-Q2')).data;
    expect(values(data).smallBusinessTurnover).toBe(30000);
    // Designer Runde 8, 342: Kz 48 nennt ihre Buchungen wie Kz 46 (Herkunft als Link).
    expect((data as VatAdvanceReturnData).values.find((v) => v.source === 'smallBusinessTurnover')!.entryIds).toEqual([income.id]);
    expect(typst(data)).toMatch(/"48";\][^\n]*\[300\]/);
    const g = await fixture();
    await book(g, { date: '2026-05-12', cents: -20000, taxCode: 'rc13bEu' });
    expect(typst((await run(g, '2026-Q2')).data)).not.toMatch(/"48";\]/);
  });

  // § 19 Abs. 1 UStG gilt nur für Unternehmer: Der Verein ohne Unternehmereigenschaft, der nur wegen § 13b anmeldet, hat
  // keine Umsätze nach § 19 (Befund 37, Recherche 2026-10-26 A.5) — auch wenn eine Einnahme als ermäßigt gekennzeichnet ist.
  it('counts no section 19 turnover without entrepreneur status', async () => {
    const f = await fixture({ entrepreneur: false });
    await book(f, { date: '2026-05-02', cents: 30000, taxCode: 'reduced', categoryId: f.purposeIncome.id });
    await book(f, { date: '2026-05-12', cents: -20000, taxCode: 'rc13bOther' });
    const data = (await run(f, '2026-Q2')).data;
    expect(values(data).smallBusinessTurnover).toBe(0);
    expect(values(data).rc13bOtherTax).toBe(3800);
  });

  it('uses month keys for monthly filers', async () => {
    const f = await fixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'vatAdvancePeriod', validFrom: '2026-01-01', value: 'month' }));
    expect((await runFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026-05' } })).ok).toBe(true);
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026-Q2' } }))).toMatchObject({ type: 'validation' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026' } }))).toMatchObject({ type: 'validation' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2024-05' } }))).toMatchObject({ code: 'vatFormMissing' });
  });

  it('runs the advance return Q4 2025 after the form 2025 and finalizes it (E11, Befund 34 c)', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    f.deps.clock.set('2026-01-09T09:00:00.000Z');
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'vatEntrepreneur', validFrom: '2025-01-01', value: true }));
    await book(f, { date: '2025-10-14', cents: -15000, taxCode: 'rc13bEu' });
    const report = await run(f, '2025-Q4');
    expect((report.data as VatAdvanceReturnData).formYear).toBe(2025);
    expect(values(report.data)).toMatchObject({ rc13bEuBase: 15000, rc13bEuTax: 2850, result: 2850 });
    expect(typst(report.data)).toMatch(/"46";\][^\n]*\[150\]/);
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2025-Q4' } }));
    expect((await run(f, '2025-Q4')).stage).toBe('final');
  });

  it('lists the entries behind each figure', async () => {
    const f = await fixture();
    const a = await book(f, { date: '2026-05-12', cents: -20000, taxCode: 'rc13bEu' });
    const b = await book(f, { date: '2026-04-12', cents: -1000, taxCode: 'rc13bEu' });
    const base = ((await run(f, '2026-Q2')).data as VatAdvanceReturnData).values.find((v) => v.source === 'rc13bEuBase')!;
    expect(base.entryIds).toEqual([a.id, b.id].sort());
  });
});

describe('stage after the end of the period', () => {
  it('can be finalized once the period has ended, in an open year', async () => {
    const f = await fixture();
    await book(f, { date: '2026-05-12', cents: -20000, taxCode: 'rc13bEu' });
    f.deps.clock.set('2026-06-30T10:00:00.000Z');
    expect((await run(f, '2026-Q2')).stage).toBe('preliminary');
    expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026-Q2' } }))).toMatchObject({ code: 'reportPeriodOpen' });
    f.deps.clock.set('2026-07-08T10:00:00.000Z');
    const review = await run(f, '2026-Q2');
    expect(review.stage).toBe('review');
    expect(review.finalizeBlock).toBeNull();
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026-Q2' } }));
    expect((await run(f, '2026-Q2')).stage).toBe('final');
    // Die Fassung hängt am Zeitraum: ein Wiederöffnen des Jahres storniert sie nicht.
    expect(reportsReopenGuard.describe(f.deps.db, f.year.id)).toBeNull();
    expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026-Q2' } }))).toMatchObject({ code: 'reportAlreadyFinal' });
    await book(f, { date: '2026-07-08', cents: -1000, taxCode: 'rc13bEu', serviceDate: '2026-06-01' });
    expect((await run(f, '2026-Q2')).stage).toBe('review');
    // Gegenprobe: ein Jahresbericht im offenen Jahr bleibt vorläufig.
    expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'vatSummary', params: { fiscalYearId: f.year.id } })).stage).toBe('preliminary');
  });
});
