import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { createOpenItem } from '../src/ledger/open-items';
import { assetOverviewAt } from '../src/ledger/queries';
import { renderContextInternal } from '../src/reporting/finalize';
import { endOtherAsset, saveOtherAsset } from '../src/reporting/other-assets';
import { assetOverviewReport, assetOverviewTypst, computeAssetOverviewReport, OTHER_ASSETS_NOT_RECORDED } from '../src/reporting/reports/asset-overview';
import { runFinanceReport } from '../src/reporting/service';
import { ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

async function fixture() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  await f.finalEntry(); // 2026-03-01, 50 € Spende auf das Bankkonto
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-11-02', text: 'Spende', moneyLines: [{ accountId: f.cash.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }] }));
  unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-01', amountCents: 1500, dueOn: '2026-02-15' }));
  unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-02-01', amountCents: 700, dueOn: '2026-02-15' }));
  return { f, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
}

describe('Bericht assetOverview (Rechenschaft A2 Task 3)', () => {
  it('reads the balances at the end of the fiscal year, like assetOverviewAt', async () => {
    const { f, y2025, y2026 } = await fixture();
    const data = computeAssetOverviewReport(f.deps.db, { fiscalYearId: y2026 });
    const plain = assetOverviewAt(f.deps.db, '2026-12-31');
    expect(data.date).toBe('2026-12-31');
    expect(data).toMatchObject({ receivablesCents: plain.receivablesCents, payablesCents: plain.payablesCents, netAssetsCents: plain.netAssetsCents, earmarkedCents: plain.earmarkedCents, reservesCents: plain.reservesCents, freeCents: plain.freeCents });
    expect(data).toMatchObject({ accountsCents: 7000, receivablesCents: 700, payablesCents: 1500, netAssetsCents: 6200 });
    expect(data.accounts.find((a) => a.accountId === f.cash.id)).toMatchObject({ kind: 'cash', balanceCents: 2000 });
    expect(computeAssetOverviewReport(f.deps.db, { fiscalYearId: y2025 })).toMatchObject({ date: '2025-12-31', accountsCents: 2000, payablesCents: 0 });
  });

  it('lists other assets and liabilities apart, without the ended ones', async () => {
    const { f, y2026 } = await fixture();
    const empty = computeAssetOverviewReport(f.deps.db, { fiscalYearId: y2026 });
    expect(empty.otherAssetsRecorded).toBe(false);
    expect(assetOverviewTypst(empty, renderContextInternal(f.deps))).toContain(OTHER_ASSETS_NOT_RECORDED);

    unwrap(await saveOtherAsset(f.deps, f.ctx, { kind: 'asset', label: 'Transportboxen', valueCents: 30000, basis: 'Rechnung', recordedFrom: '2026-03-01' }));
    unwrap(await saveOtherAsset(f.deps, f.ctx, { kind: 'asset', label: 'Pavillon', valueCents: 12000, basis: 'Schätzung', recordedFrom: '2026-04-01' }));
    unwrap(await saveOtherAsset(f.deps, f.ctx, { kind: 'liability', label: 'Darlehen eines Mitglieds', valueCents: 50000, basis: 'Vertrag', recordedFrom: '2026-01-10' }));
    const gone = unwrap(await saveOtherAsset(f.deps, f.ctx, { kind: 'asset', label: 'Altes Zelt', valueCents: 5000, basis: 'Schätzung', recordedFrom: '2026-01-01' }));
    unwrap(await endOtherAsset(f.deps, f.ctx, { id: gone.id, until: '2026-06-30' }));

    const data = computeAssetOverviewReport(f.deps.db, { fiscalYearId: y2026 });
    expect(data.otherAssets).toMatchObject({ assetsCents: 42000, liabilitiesCents: 50000, recorded: true });
    expect(data.otherAssets.items).toHaveLength(3);
    // Keine Bezeichnung in den gehashten Daten — sie kommt über den Render-Kontext.
    expect(JSON.stringify(data)).not.toContain('Transportboxen');
    const typst = assetOverviewTypst(data, renderContextInternal(f.deps));
    expect(typst).toContain('Transportboxen (Rechnung)');
    expect(typst).not.toContain('Altes Zelt');
    expect(typst).not.toContain(OTHER_ASSETS_NOT_RECORDED);
  });

  it('takes a day instead of the year, and its year is the one of that day', async () => {
    const { f, y2025 } = await fixture();
    expect(assetOverviewReport.years(f.deps.db, { date: '2025-11-30' })).toEqual([y2025]);
    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'assetOverview', params: { date: '2025-11-30' } }));
    expect(run.data).toMatchObject({ date: '2025-11-30', accountsCents: 2000 });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'assetOverview', params: { date: '2019-01-01' } }))).toMatchObject({ type: 'notFound' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'assetOverview', params: { fiscalYearId: y2025, date: '2025-11-30' } }))).toMatchObject({ type: 'validation' });
  });
});

describe('eine Kontenliste für Berichte und Jahresabschluss (Designer Runde 7, 248/244, 272/295)', () => {
  it('cash report, asset overview, reconciliation and step 1 list the same accounts from one function; 0,00 included, a dormant one not', async () => {
    const { f, y2025 } = await fixture();
    const { computeCashReport } = await import('../src/reporting/reports/cash-report');
    const { computeAccountReconciliation } = await import('../src/reporting/reports/account-reconciliation');
    const { accountStatementsForYearInternal } = await import('../src/ledger/statement-documents');
    const { createAccount, setAccountActive } = await import('../src/ledger/accounts');
    const { reportAccountIdsInternal } = await import('../src/reporting/reports/common');
    const zero = unwrap(await createAccount(f.deps, f.ctx, { name: 'Tagesgeld', kind: 'bank', iban: 'DE48999999990000404040', openingBalanceCents: 0, openingDate: '2025-01-01' }));
    const old = unwrap(await createAccount(f.deps, f.ctx, { name: 'Altes Sparbuch', kind: 'bank', iban: 'AT939999900001234567' }));
    unwrap(await setAccountActive(f.deps, f.ctx, { id: old.id, isActive: false }));
    const expected = reportAccountIdsInternal(f.deps.db, { from: '2025-01-01', to: '2025-12-31' });
    expect(computeAssetOverviewReport(f.deps.db, { fiscalYearId: y2025 }).accounts.map((a) => a.accountId)).toEqual(expected);
    expect(computeCashReport(f.deps.db, { fiscalYearId: y2025 }).accounts.map((a) => a.accountId)).toEqual(expected);
    expect(computeAccountReconciliation(f.deps.db, { fiscalYearId: y2025 }).accounts.map((a) => a.accountId)).toEqual(expected);
    const kinds = new Map([[f.cash.id, 'cash']]);
    expect(accountStatementsForYearInternal(f.deps.db, y2025).map((r) => r.accountId)).toEqual(expected.filter((id) => kinds.get(id) !== 'cash'));
    expect(expected).toContain(zero.id);
    expect(expected).not.toContain(old.id);
  });
});
