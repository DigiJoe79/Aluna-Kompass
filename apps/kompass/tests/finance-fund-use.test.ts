import type { FundsUseBucket, FundsUseReport } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { fundsUseHead, fundsUseNotices } from '@/app/(shell)/finance/fund-use/funds-use-view';

/**
 * Kopfsatz und Warnungen der Seite Mittelverwendung (Plan U2 Task 2; Designer Frage 4, Abnahme 12): Welche Warnung
 * erscheint und welcher Kopfsatz gilt, entscheiden zwei reine Funktionen. Die Grenze selbst rechnet M1 — die
 * Oberfläche liest nur `obligation`.
 */

const bucket = (over: Partial<FundsUseBucket> = {}): FundsUseBucket => ({
  originKey: 'fy:y24',
  originDesignation: '2024',
  originEndsOn: '2024-12-31',
  dueBy: '2026-12-31',
  originRequired: true,
  openingCents: 500_000,
  lateAllocationCents: 0,
  usedCents: 0,
  restCents: 0,
  state: 'used',
  ...over,
});

function report(over: { head?: Partial<FundsUseReport['head']>; buckets?: FundsUseBucket[]; loss?: { business?: number; assetManagement?: number }; warnings?: FundsUseReport['partA']['warnings'] } = {}): FundsUseReport {
  const head: FundsUseReport['head'] = { revenueCents: 7_170_000, limitCents: 10_000_000, obligation: 'voluntary', noLimit: false, assetSalesNotInRevenueCents: 0, ...over.head };
  const business = over.loss?.business ?? 0;
  const assetManagement = over.loss?.assetManagement ?? 0;
  const partA = {
    fiscalYearId: 'y26',
    obligation: head.obligation,
    noLimit: head.noLimit,
    lossOffset: { businessLossCents: business, assetManagementLossCents: assetManagement, totalCents: business + assetManagement },
    buckets: over.buckets ?? [],
    warnings: over.warnings ?? [],
  } as unknown as FundsUseReport['partA'];
  return { year: { id: 'y26', designation: '2026' }, head, partA } as unknown as FundsUseReport;
}

describe('fundsUseNotices / fundsUseHead (Plan U2, Abnahme 12)', () => {
  it('below the limit: no deadline warning, loss warning stays', () => {
    const r = report({ head: { obligation: 'voluntary' }, buckets: [bucket({ restCents: 80_000, state: 'lapsed' })], loss: { business: 125_000 }, warnings: ['lossOffset'] });
    expect(fundsUseNotices(r)).toEqual([{ kind: 'loss', sphere: 'business', cents: 125_000 }]);
    expect(fundsUseHead(r.head).case).toBe('voluntary');
  });

  it('exactly at the limit is voluntary — the obligation comes from M1, the page reads it', () => {
    const r = report({ head: { revenueCents: 10_000_000, limitCents: 10_000_000, obligation: 'voluntary' }, buckets: [bucket({ restCents: 1, state: 'lapsed' })] });
    expect(fundsUseHead(r.head)).toEqual({ case: 'voluntary', revenueCents: 10_000_000, limitCents: 10_000_000, assetSalesCents: 0 });
    expect(fundsUseNotices(r)).toEqual([]);
  });

  it('above the limit: overdue buckets warn, open and used ones do not', () => {
    const r = report({
      head: { revenueCents: 12_840_000, obligation: 'required' },
      buckets: [
        bucket({ originDesignation: '2024', restCents: 340_000, dueBy: '2026-12-31', state: 'overdue' }),
        bucket({ originKey: 'fy:y25', originDesignation: '2025', restCents: 90_000, dueBy: '2027-12-31', state: 'open' }),
        bucket({ originKey: 'fy:y23', originDesignation: '2023', state: 'used' }),
      ],
      warnings: ['deadlineMissed'],
    });
    expect(fundsUseHead(r.head).case).toBe('required');
    expect(fundsUseNotices(r)).toEqual([{ kind: 'deadlineMissed', origin: '2024', restCents: 340_000, dueBy: '2026-12-31' }]);
  });

  it('a year without a limit (before 2021) has its own head case', () => {
    const r = report({ head: { limitCents: null, noLimit: true, obligation: 'required' } });
    expect(fundsUseHead(r.head)).toEqual({ case: 'noLimit', revenueCents: 7_170_000, limitCents: null, assetSalesCents: 0 });
  });

  it('carries the asset sales the limit leaves out', () => {
    expect(fundsUseHead(report({ head: { assetSalesNotInRevenueCents: 45_000 } }).head).assetSalesCents).toBe(45_000);
  });

  it('orders deadline, loss in the business operation, loss in asset management, endowment', () => {
    const r = report({
      head: { obligation: 'required' },
      buckets: [bucket({ restCents: 10_000, state: 'overdue' })],
      loss: { business: 2_000, assetManagement: 3_000 },
      warnings: ['endowmentWithOverhang', 'lossOffset', 'deadlineMissed'],
    });
    expect(fundsUseNotices(r).map((n) => (n.kind === 'loss' ? `loss:${n.sphere}` : n.kind))).toEqual(['deadlineMissed', 'loss:business', 'loss:assetManagement', 'endowmentWithOverhang']);
  });
});
