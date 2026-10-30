import { describe, expect, it } from 'vitest';
import { addYearsToDay, fundsUseChain, fundsUseObligation, fundsUseOpeningEffects, type FundsUseYearInput } from '../src/allocation/funds-use-rules';

const ENDS = ['2024-12-31', '2025-12-31', '2026-12-31'] as const;

function yr(index: number, over: Partial<FundsUseYearInput> = {}): FundsUseYearInput {
  return {
    fiscalYearId: `J${index + 1}`,
    designation: String(2024 + index),
    endsOn: ENDS[index]!,
    revenueCents: 20_000_000,
    limitCents: 10_000_000,
    idealIncomeCents: 0,
    assetSalesCents: 0,
    endowmentCents: 0,
    assetManagementResultCents: 0,
    purposeOperationResultCents: 0,
    businessResultCents: 0,
    idealExpenseCents: 0,
    reserveReleasesCents: 0,
    reserveAllocationsCents: 0,
    lateAllocations: [],
    ...over,
  };
}

describe('funds-use-rules — Fortschreibung der Mittelverwendung (M1 Task 1)', () => {
  it('reserve formed in t−1 and used in t leaves A4(t) at 0 (Prüfung F-1)', () => {
    const r = fundsUseChain([yr(0, { idealIncomeCents: 10_000, reserveAllocationsCents: 10_000 }), yr(1, { idealIncomeCents: 5_000, idealExpenseCents: 15_000, reserveReleasesCents: 10_000 })], []);
    expect(r[0]!.a4RestCents).toBe(0);
    expect(r[1]!.a4RestCents).toBe(0);
    expect(r[1]!.overhangOutCents).toBe(0);
    expect(r[1]!.backlogCents).toBe(0);
  });

  it('above, not above, above: the middle year lapses everything (Prüfung F-4)', () => {
    const r = fundsUseChain(
      [
        yr(0, { revenueCents: 12_000_000, idealIncomeCents: 12_000_000, idealExpenseCents: 11_000_000 }),
        yr(1, { revenueCents: 9_000_000, idealIncomeCents: 9_000_000, idealExpenseCents: 9_000_000 }),
        yr(2, { revenueCents: 11_000_000, idealIncomeCents: 11_000_000, idealExpenseCents: 10_000_000 }),
      ],
      [],
    );
    expect(r[0]!.buckets.at(-1)!.restCents).toBe(1_000_000);
    expect(r[0]!.buckets.at(-1)!.state).toBe('open');
    expect(r[1]!.obligation).toBe('voluntary');
    expect(r[1]!.lapsedAtEnd).toBe(true);
    expect(r[1]!.buckets.every((b) => b.state === 'lapsed')).toBe(true);
    expect(r[1]!.backlogCents).toBe(0);
    expect(r[2]!.buckets.length).toBe(1);
    expect(r[2]!.overhangInCents).toBe(0);
    expect(r[2]!.backlogCents).toBe(1_000_000);
  });

  it('exactly at the limit is voluntary; no limit means the duty applies', () => {
    expect(fundsUseObligation(10_000_000, 10_000_000)).toBe('voluntary');
    expect(fundsUseObligation(10_000_001, 10_000_000)).toBe('required');
    expect(fundsUseObligation(10, null)).toBe('required');
    const [r] = fundsUseChain([yr(0, { limitCents: null })], []);
    expect(r!.obligation).toBe('required');
    expect(r!.noLimit).toBe(true);
  });

  it('purpose operation loss is use, business and asset management losses are an own line (Prüfung F-2, F-3)', () => {
    const losses = { purposeOperationResultCents: -30_000, businessResultCents: -20_000, assetManagementResultCents: -5_000 };
    const [r] = fundsUseChain([yr(0, losses)], []);
    expect(r!.a2.purposeOperationLossCents).toBe(30_000);
    expect(r!.lossOffset.businessLossCents).toBe(20_000);
    expect(r!.lossOffset.assetManagementLossCents).toBe(5_000);
    expect(r!.lossOffset.totalCents).toBe(25_000);
    expect(r!.warnings).toContain('lossOffset');
    const [v] = fundsUseChain([yr(0, { ...losses, revenueCents: 1_000 })], []);
    expect(v!.obligation).toBe('voluntary');
    expect(v!.warnings).toContain('lossOffset');
    expect(v!.warnings).not.toContain('deadlineMissed');
  });

  it('oldest first (Prüfung H-5)', () => {
    const r = fundsUseChain([yr(0, { idealIncomeCents: 30_000 }), yr(1, { idealIncomeCents: 20_000 }), yr(2, { idealIncomeCents: 10_000, idealExpenseCents: 35_000 })], []);
    const [j1, j2, own] = r[2]!.buckets;
    expect(j1!.originKey).toBe('fy:J1');
    expect(j1!.usedCents).toBe(30_000);
    expect(j1!.state).toBe('used');
    expect(j2!.originKey).toBe('fy:J2');
    expect(j2!.usedCents).toBe(5_000);
    expect(j2!.restCents).toBe(15_000);
    expect(own!.originKey).toBe('fy:J3');
    expect(own!.restCents).toBe(10_000);
  });

  it('overhang is carried and set against the next inflow (Prüfung L-5)', () => {
    const r = fundsUseChain([yr(0, { idealIncomeCents: 10_000, idealExpenseCents: 15_000 }), yr(1, { idealIncomeCents: 20_000 })], []);
    expect(r[0]!.overhangOutCents).toBe(5_000);
    expect(r[0]!.backlogCents).toBe(0);
    expect(r[1]!.overhangInCents).toBe(5_000);
    expect(r[1]!.buckets.at(-1)!.restCents).toBe(15_000);
  });

  it('late formation reduces the origin year in the year of the resolution (Prüfung L-3)', () => {
    const j1 = yr(0, { idealIncomeCents: 50_000, idealExpenseCents: 20_000 });
    const small = fundsUseChain([j1, yr(1, { lateAllocations: [{ originKey: 'fy:J1', cents: 10_000 }] })], []);
    const origin = small[1]!.buckets.find((b) => b.originKey === 'fy:J1')!;
    expect(origin.lateAllocationCents).toBe(10_000);
    expect(origin.restCents).toBe(20_000);
    expect(small[1]!.a3.totalCents).toBe(0);
    const big = fundsUseChain([j1, yr(1, { lateAllocations: [{ originKey: 'fy:J1', cents: 40_000 }] })], []);
    expect(big[1]!.buckets.find((b) => b.originKey === 'fy:J1')!.lateAllocationCents).toBe(30_000);
    expect(big[1]!.a3.lateExcessCents).toBe(10_000);
    expect(big[1]!.a3.totalCents).toBe(10_000);
    expect(small[0]).toEqual(fundsUseChain([j1], [])[0]);
    expect(big[0]).toEqual(fundsUseChain([j1], [])[0]);
  });

  it('missed deadline only above the limit', () => {
    const r = fundsUseChain([yr(0, { idealIncomeCents: 30_000 }), yr(1), yr(2)], []);
    const j1 = r[2]!.buckets.find((b) => b.originKey === 'fy:J1')!;
    expect(j1.state).toBe('overdue');
    expect(j1.dueBy).toBe('2026-12-31');
    expect(r[2]!.warnings).toContain('deadlineMissed');
    expect(r[1]!.buckets.find((b) => b.originKey === 'fy:J1')!.state).toBe('open');
    const v = fundsUseChain([yr(0, { idealIncomeCents: 30_000 }), yr(1), yr(2, { revenueCents: 1_000 })], []);
    expect(v[2]!.buckets.find((b) => b.originKey === 'fy:J1')!.state).toBe('lapsed');
    expect(v[2]!.warnings).not.toContain('deadlineMissed');
  });

  it('endowment with an overhang warns (Prüfung L-5)', () => {
    const r = fundsUseChain([yr(0, { endowmentCents: 1_000, idealIncomeCents: 10_000 }), yr(1, { idealExpenseCents: 5_000 })], []);
    expect(r[0]!.warnings).not.toContain('endowmentWithOverhang');
    expect(r[1]!.overhangOutCents).toBe(0);
    const o = fundsUseChain([yr(0, { endowmentCents: 1_000 }), yr(1, { idealExpenseCents: 5_000 })], []);
    expect(o[1]!.overhangOutCents).toBe(5_000);
    expect(o[1]!.warnings).toContain('endowmentWithOverhang');
  });

  it('a negative A1 counts as outflow', () => {
    const [r] = fundsUseChain([yr(0, { idealIncomeCents: -2_000 })], []);
    expect(r!.a1.totalCents).toBe(-2_000);
    expect(r!.overhangOutCents).toBe(2_000);
    expect(r!.a4RestCents).toBe(-2_000);
  });

  it('openings (Prüfung L-4)', () => {
    const o1 = { offset: 1 as const, designation: '2025', endsOn: '2025-12-31', revenueCents: 5_000_000, amountCents: 300_000, limitCents: 4_500_000 };
    const o2 = { offset: 2 as const, designation: '2024', endsOn: '2024-12-31', revenueCents: 4_000_000, amountCents: 150_000, limitCents: 4_500_000 };
    const effects = fundsUseOpeningEffects([o1, o2]);
    expect(effects.find((e) => e.offset === 1)).toEqual({ offset: 1, effectiveCents: 300_000, zeroReason: null, dueBy: '2027-12-31' });
    expect(effects.find((e) => e.offset === 2)).toMatchObject({ effectiveCents: 0, zeroReason: 'belowLimit' });
    const followed = fundsUseOpeningEffects([{ ...o1, revenueCents: 4_000_000 }, { ...o2, revenueCents: 5_000_000 }]);
    expect(followed.find((e) => e.offset === 1)).toMatchObject({ effectiveCents: 0, zeroReason: 'belowLimit' });
    expect(followed.find((e) => e.offset === 2)).toMatchObject({ effectiveCents: 0, zeroReason: 'followedByYearBelowLimit' });
    expect(fundsUseOpeningEffects([{ ...o1, limitCents: null, revenueCents: 1 }])[0]).toMatchObject({ effectiveCents: 300_000, zeroReason: null });
    const [first] = fundsUseChain([{ ...yr(0), endsOn: '2026-12-31' }], [o1, o2]);
    const openings = first!.buckets.filter((b) => b.originKey.startsWith('opening:'));
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ originKey: 'opening:1', openingCents: 300_000, originRequired: true, dueBy: '2027-12-31', state: 'open' });
  });

  it('openings come oldest first and are used before the own year', () => {
    const o1 = { offset: 1 as const, designation: '2025', endsOn: '2025-12-31', revenueCents: 5_000_000, amountCents: 300_000, limitCents: 4_500_000 };
    const o2 = { offset: 2 as const, designation: '2024', endsOn: '2024-12-31', revenueCents: 5_000_000, amountCents: 100_000, limitCents: 4_500_000 };
    const [first] = fundsUseChain([{ ...yr(0), endsOn: '2026-12-31', idealIncomeCents: 50_000, idealExpenseCents: 150_000 }], [o1, o2]);
    expect(first!.buckets.map((b) => b.originKey)).toEqual(['opening:2', 'opening:1', 'fy:J1']);
    expect(first!.buckets[0]).toMatchObject({ usedCents: 100_000, restCents: 0, state: 'used' });
    expect(first!.buckets[1]).toMatchObject({ usedCents: 50_000, restCents: 250_000, state: 'open' });
  });

  it('addYearsToDay keeps the day and cuts 29 February', () => {
    expect(addYearsToDay('2024-02-29', 2)).toBe('2026-02-28');
    expect(addYearsToDay('2025-12-31', 2)).toBe('2027-12-31');
    expect(addYearsToDay('2025-12-31', -1)).toBe('2024-12-31');
    expect(addYearsToDay('2028-02-29', 4)).toBe('2032-02-29');
  });
});
