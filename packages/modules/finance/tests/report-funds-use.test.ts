import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { saveFundsUseOpening } from '../src/allocation/funds-use-openings';
import { recordReserveMovement, saveReserve } from '../src/allocation/reserves';
import { createCategory } from '../src/ledger/categories';
import { bookEntry } from '../src/ledger/finalize';
import { createOpenItem } from '../src/ledger/open-items';
import { fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { finalizeFinanceReport, renderContextInternal } from '../src/reporting/finalize';
import { reportHash } from '../src/reporting/hash';
import { saveOtherAsset } from '../src/reporting/other-assets';
import { fundsUseReport, type FundsUseReport } from '../src/reporting/reports/funds-use';
import { annualRevenueForGemInternal } from '../src/reporting/revenue';
import { fundsUseAppliesInternal, fundsUseChainInternal } from '../src/reporting/funds-use-inputs';
import { listFinanceReports, runFinanceReport } from '../src/reporting/service';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const upload = (date: string) => ({ bytes: pdfBytes(), fileName: 'beschluss.pdf', documentDate: date });

async function setup() {
  const f = await ledgerFixture({ years: ['2023', '2024', '2025', '2026'] });
  const y = (d: string) => f.years[d]!.id;
  const donate = (date: string, cents: number) => bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents }] }).then(unwrap);
  const spend = (date: string, cents: number) => bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Projektkosten', moneyLines: [{ accountId: f.bank.id, amountCents: -cents }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -cents }] }).then(unwrap);
  const compute = (d: string): FundsUseReport => fundsUseReport.compute(f.deps.db, { fiscalYearId: y(d) }, { settings: {} });
  const reserve = async (kind: 'projectFunds' | 'assetManagement' | 'business', date: string) =>
    unwrap(await saveReserve(f.deps, f.ctx, { kind, name: `Rücklage ${kind}`, purposeText: 'Zweck der Rücklage', resolutionUpload: upload(date) }));
  const move = async (reserveId: string, kind: 'allocate' | 'withdraw', date: string, amountCents: number, forFiscalYearId?: string) =>
    unwrap(await recordReserveMovement(f.deps, f.ctx, { reserveId, kind, movementDate: date, amountCents, resolutionUpload: upload(date), ...(forFiscalYearId ? { forFiscalYearId } : {}) }));
  return { f, y, donate, spend, compute, reserve, move };
}

describe('Bericht fundsUse — Mittelverwendungsrechnung (M1 Task 4)', () => {
  it('reserve formed in t−1 and used in t (Prüfung F-1)', async () => {
    const { donate, spend, compute, reserve, move } = await setup();
    await donate('2024-03-01', 10_000);
    const r = await reserve('projectFunds', '2024-12-10');
    await move(r.id, 'allocate', '2024-12-15', 10_000);
    await donate('2025-03-01', 5_000);
    await spend('2025-04-01', 15_000);
    await move(r.id, 'withdraw', '2025-04-02', 10_000);
    expect(compute('2024').partA.a4RestCents).toBe(0);
    expect(compute('2024').partA.a3.reserveAllocationsCents).toBe(10_000);
    expect(compute('2025').partA.a1.reserveReleasesCents).toBe(10_000);
    expect(compute('2025').partA.a4RestCents).toBe(0);
  });

  it('over, not over, over with real bookings (Prüfung F-4)', async () => {
    const { f, y, donate, spend, compute } = await setup();
    await donate('2023-03-01', 5_000_000);
    await spend('2023-04-01', 4_900_000);
    await donate('2024-03-01', 4_000_000);
    await spend('2024-04-01', 4_000_000);
    await donate('2025-03-01', 5_000_000);
    await spend('2025-04-01', 4_950_000);
    // Vorträge entfallen erst mit dem Abschluss eines Jahres nicht über der Grenze (M2, Abnahme).
    for (const d of ['2023', '2024', '2025']) f.closeYear(y(d));
    const y2023 = compute('2023');
    expect(y2023.head.obligation).toBe('required');
    expect(y2023.head.limitCents).toBe(4_500_000);
    expect(y2023.partA.backlogCents).toBe(100_000);
    const y2024 = compute('2024');
    expect(y2024.head.obligation).toBe('voluntary');
    expect(y2024.partA.lapsedAtEnd).toBe(true);
    const y2025 = compute('2025');
    expect(y2025.partA.buckets).toHaveLength(1);
    expect(y2025.partA.backlogCents).toBe(50_000);    // M2: die Frage nach der Pflicht rechnet ohne Kette, mit demselben Ergebnis wie der Kopf.
    for (const d of ['2023', '2024', '2025', '2026']) expect(fundsUseAppliesInternal(f.deps.db, y(d)), d).toBe(compute(d).head.obligation === 'required');
  });

  it('head uses the Gem revenue and names asset sales (Prüfung L-6, L-8)', async () => {
    const { f, y, compute } = await setup();
    const sale = unwrap(await createCategory(f.deps, f.ctx, { key: 'asset-sale', name: 'Verkauf Anlage', direction: 'income', sphere: 'ideal', incomeKind: 'other', isAssetSale: true }));
    await bookEntry(f.deps, f.ctx, { entryDate: '2025-05-01', text: 'Verkauf', moneyLines: [{ accountId: f.bank.id, amountCents: 10_000 }], allocationLines: [{ categoryId: sale.id, amountCents: 10_000 }] }).then(unwrap);
    await bookEntry(f.deps, f.ctx, { entryDate: '2025-05-02', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 3_000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3_000 }] }).then(unwrap);
    const d = compute('2025');
    expect(d.partA.a1.assetSalesCents).toBe(10_000);
    expect(d.partA.a1.idealIncomeCents).toBe(13_000);
    expect(d.head.assetSalesNotInRevenueCents).toBe(10_000);
    expect(d.head.revenueCents).toBe(annualRevenueForGemInternal(f.deps.db, y('2025')).totalCents);
    expect(d.head.revenueCents).toBe(3_000);
  });

  it('late formation leaves the finalized origin year untouched (Prüfung L-3)', async () => {
    const { y, donate, compute, reserve, move } = await setup();
    await donate('2024-03-01', 5_000_000);
    const params = { fiscalYearId: y('2024') };
    const before = reportHash('fundsUse', params, compute('2024')).hash;
    expect(compute('2024').partA.backlogCents).toBe(5_000_000);
    const r = await reserve('projectFunds', '2025-01-30');
    await move(r.id, 'allocate', '2025-02-01', 40_000, y('2024'));
    expect(reportHash('fundsUse', params, compute('2024')).hash).toBe(before);
    const y2025 = compute('2025');
    expect(y2025.partA.buckets[0]).toMatchObject({ originKey: `fy:${y('2024')}`, lateAllocationCents: 40_000, restCents: 4_960_000 });
    expect(y2025.partA.a3.totalCents).toBe(0);
  });

  it('part B deducts reserves, liabilities and endowment and keeps other assets apart (Prüfung L-6)', async () => {
    const { f, donate, compute, reserve, move } = await setup();
    await donate('2026-02-01', 50_000);
    unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5_000 }));
    unwrap(await saveOtherAsset(f.deps, f.ctx, { kind: 'liability', label: 'Kaution', valueCents: 2_000, basis: 'Vertrag', recordedFrom: '2026-03-01' }));
    unwrap(await saveOtherAsset(f.deps, f.ctx, { kind: 'asset', label: 'Transportboxen', valueCents: 7_000, basis: 'Rechnung', recordedFrom: '2026-03-01' }));
    const p = await reserve('projectFunds', '2026-04-01');
    await move(p.id, 'allocate', '2026-04-02', 10_000);
    const vv = await reserve('assetManagement', '2026-04-03');
    await move(vv.id, 'allocate', '2026-04-04', 3_000);
    const b = compute('2026').partB;
    expect(b).toMatchObject({ date: '2026-12-31', accountsCents: 50_000, payablesCents: 5_000, otherLiabilitiesCents: 2_000, endowmentCents: 0, section62ReservesCents: 10_000, operationReservesCents: 3_000, remainingCents: 30_000, otherAssetsCents: 7_000, notCovered: ['fixedAssets', 'loans', 'securities'] });
    expect(b.differenceCents).toBe(b.remainingCents - b.partAResultCents);
  });

  it('openings appear only in the first year', async () => {
    const { f, compute } = await setup();
    unwrap(await saveFundsUseOpening(f.deps, f.ctx, { offset: 1, designation: '2022', endsOn: '2022-12-31', revenueCents: 5_200_000, amountCents: 300_000, upload: upload('2023-02-01') }));
    const first = compute('2023');
    expect(first.openings).toHaveLength(1);
    expect(first.partA.buckets[0]).toMatchObject({ originKey: 'opening:1', openingCents: 300_000 });
    expect(compute('2024').openings).toBeNull();
  });

  it('is available in the catalogue (M2)', async () => {
    const { f, y, donate } = await setup();
    await donate('2025-03-01', 5_000_000);
    const params = { fiscalYearId: y('2025') };
    expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'fundsUse', params })).stage).toBe('preliminary');
    expect(unwrap(await listFinanceReports(f.deps, f.ctx, params)).reports.find((r) => r.key === 'fundsUse')).toMatchObject({ available: true, group: 'taxOffice', stage: 'preliminary' });
    for (const d of ['2023', '2024', '2025']) f.closeYear(y(d));
    expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'fundsUse', params })).stage).toBe('review');
    // Gruppe Finanzamt: ohne Freigabe der Kassenprüfung festschreibbar; der Auszug zum Stichtag liegt (Schritt 1).
    unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
    const done = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'fundsUse', params }));
    expect(f.deps.db.select().from(documents).where(eq(documents.id, done.documentId)).get()).toMatchObject({ typeKey: 'finance-report', status: 'issued' });
    expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'fundsUse', params })).stage).toBe('final');
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'fundsUse', params: { fiscalYearId: y('2024') } }))).toBe('ok');
  });

  it('typst carries the parts and the assumptions', async () => {
    const { f, y, donate, spend, compute } = await setup();
    for (const d of ['2023', '2024']) f.closeYear(y(d));
    await donate('2025-03-01', 5_000_000);
    await spend('2025-04-01', 100_000);
    const body = fundsUseReport.toTypst(compute('2025'), renderContextInternal(f.deps));
    for (const text of ['Teil A', 'Teil B', 'Teil C', 'ältesten Mittel zuerst', 'Ausgleich Verlust wGB / VV aus anderen Mitteln', 'diese Rechnung ist der Nachweis (AEAO zu § 55 Nr. 29)']) expect(body).toContain(text);
    const voluntary = fundsUseReport.toTypst(compute('2024'), renderContextInternal(f.deps));
    expect(voluntary).toContain('Nicht über der Grenze von');
    expect(voluntary).toContain('entfallen alle Vorträge (AEAO zu § 55 Nr. 31)');
    expect(voluntary).not.toContain('veröffentlich');
  });

  it('an open year not above the limit keeps the backlog with its deadline until it is closed (M2, Abnahme)', async () => {
    const { f, y, donate, spend, compute } = await setup();
    await donate('2024-03-01', 5_000_000);
    await spend('2024-04-01', 4_900_000);
    f.closeYear(y('2023'));
    f.closeYear(y('2024'));
    await donate('2025-03-01', 1_000);
    const open = compute('2025');
    expect(open.head.obligation).toBe('voluntary');
    expect(open.partA.lapsedAtEnd).toBe(false);
    expect(open.partA.buckets[0]).toMatchObject({ originKey: `fy:${y('2024')}`, restCents: 100_000, dueBy: '2026-12-31', state: 'open' });
    expect(open.partA.backlogCents).toBe(101_000);
    const body = fundsUseReport.toTypst(open, renderContextInternal(f.deps));
    expect(body).toContain('Entfällt, wenn das Jahr 2025 mit Einnahmen nicht über der Grenze abgeschlossen wird.');
    expect(body).not.toContain('entfallen alle Vorträge');
    f.closeYear(y('2025'));
    const closed = compute('2025');
    expect(closed.partA.lapsedAtEnd).toBe(true);
    expect(closed.partA.buckets.every((b) => b.state === 'lapsed')).toBe(true);
    expect(fundsUseReport.toTypst(closed, renderContextInternal(f.deps))).not.toContain('Entfällt, wenn das Jahr');
  });

  it('Teil B unter der Grenze: die Differenz zu Teil A ist der entfallene Vortrag, nicht unerklärt (Bildabnahme 0.4.5 W-5)', async () => {
    const { f, y, donate, compute } = await setup();
    for (const d of ['2023', '2024']) f.closeYear(y(d));
    await donate('2025-03-01', 13_200);
    f.closeYear(y('2025'));
    const closed = compute('2025');
    expect(closed.partA.lapsedAtEnd).toBe(true);
    expect(closed.partB.partAResultCents).toBe(0);
    expect(closed.partB.differenceCents).toBeGreaterThan(0);
    const body = fundsUseReport.toTypst(closed, renderContextInternal(f.deps));
    expect(body).toContain('Zum 31.12.2025 entfallen (AEAO zu § 55 Nr. 31)');
    expect(body).not.toContain('Die Differenz zu Teil A erklärt sich');
    expect(body).not.toMatch(/\[\*?Differenz\*?\]/);
  });

  it('closed years compute as before, so finalized reports keep their hash (M2, Abnahme)', async () => {
    const { f, y, donate, spend, compute } = await setup();
    await donate('2023-03-01', 5_000_000);
    await spend('2023-04-01', 4_900_000);
    await donate('2024-03-01', 4_000_000);
    await donate('2025-03-01', 5_000_000);
    for (const d of ['2023', '2024', '2025']) f.closeYear(y(d));
    for (const d of ['2023', '2024', '2025']) {
      // Die bisherige Regel (alle Jahre nicht über der Grenze entfallen) — für abgeschlossene Jahre dieselben Daten.
      const before = { ...compute(d), partA: fundsUseChainInternal(f.deps.db, y(d)).at(-1)! };
      expect(reportHash('fundsUse', { fiscalYearId: y(d) }, compute(d)).hash, d).toBe(reportHash('fundsUse', { fiscalYearId: y(d) }, before).hash);
    }
  });
});
