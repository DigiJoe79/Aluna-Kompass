import { describe, expect, it } from 'vitest';
import { freeReserveCapCents } from '../src/allocation/reserve-rules';

describe('freeReserveCapCents (F8b Annahme 4, § 62 Abs. 1 Nr. 3 AO — Näherung)', () => {
  it('floors 33 percent of a positive asset-management surplus and treats a negative one as zero', () => {
    expect(freeReserveCapCents({ assetManagementSurplusCents: 10_001, otherTimelyFundsCents: 0, assetSharePercent: 33, otherSharePercent: 10 })).toBe(3300);
    expect(freeReserveCapCents({ assetManagementSurplusCents: -50_000, otherTimelyFundsCents: 0, assetSharePercent: 33, otherSharePercent: 10 })).toBe(0);
  });

  it('takes a tenth of ideal income without asset additions plus positive surpluses of purpose operation and business', () => {
    expect(freeReserveCapCents({ assetManagementSurplusCents: 0, otherTimelyFundsCents: 100_007, assetSharePercent: 33, otherSharePercent: 10 })).toBe(10_000);
  });

  it('adds both parts together', () => {
    expect(freeReserveCapCents({ assetManagementSurplusCents: 30_000, otherTimelyFundsCents: 20_000, assetSharePercent: 33, otherSharePercent: 10 })).toBe(9900 + 2000);
  });
});
