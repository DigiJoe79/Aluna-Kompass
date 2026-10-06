import { describe, expect, it } from 'vitest';
import { freeReserveCapCents, freeReserveYears, type FreeReserveYearInput } from '../src/allocation/reserve-rules';

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

describe('freeReserveYears (Befund 4, Fassung 0.2.7)', () => {
  const fy = (designation: string, startsOn: string, endsOn: string, status: 'open' | 'closed' = 'open'): FreeReserveYearInput => ({ id: `FY-${designation}`, designation, startsOn, endsOn, status });
  const calendar = (year: number, status: 'open' | 'closed' = 'open') => fy(String(year), `${year}-01-01`, `${year}-12-31`, status);
  const shown = (r: ReturnType<typeof freeReserveYears>) => r.years.map((y) => `${y.designation}${y.provisional ? ' vorläufig' : ''}`);

  it('shows the open previous year first, provisional, and proposes it — in January', () => {
    const r = freeReserveYears([calendar(2027), calendar(2026), calendar(2025, 'closed')], '2027-01-15');
    expect(shown(r)).toEqual(['2026 vorläufig', '2027']);
    expect(r.defaultFiscalYearId).toBe('FY-2026');
  });

  it('drops the previous year once it is closed', () => {
    const r = freeReserveYears([calendar(2026, 'closed'), calendar(2027)], '2027-01-15');
    expect(shown(r)).toEqual(['2027']);
    expect(r.defaultFiscalYearId).toBe('FY-2027');
  });

  it('knows no month: in October a closed previous year is gone, an open one still shows', () => {
    expect(shown(freeReserveYears([calendar(2026, 'closed'), calendar(2027)], '2027-10-06'))).toEqual(['2027']);
    expect(shown(freeReserveYears([calendar(2026), calendar(2027)], '2027-10-06'))).toEqual(['2026 vorläufig', '2027']);
  });

  it('shows only the current year in the first fiscal year', () => {
    const r = freeReserveYears([calendar(2026)], '2026-10-06');
    expect(shown(r)).toEqual(['2026']);
    expect(r.defaultFiscalYearId).toBe('FY-2026');
  });

  it('counts only the year right before — an older open year is not shown (no two-year window)', () => {
    expect(shown(freeReserveYears([calendar(2025), calendar(2026), calendar(2027)], '2027-03-01'))).toEqual(['2026 vorläufig', '2027']);
    expect(shown(freeReserveYears([calendar(2025), calendar(2026, 'closed'), calendar(2027)], '2027-03-01'))).toEqual(['2027']);
  });

  it('goes by dates: a short first year and fiscal years from July', () => {
    const short = fy('2026', '2026-01-01', '2026-06-30');
    const july = fy('2026-2', '2026-07-01', '2027-06-30');
    expect(shown(freeReserveYears([short, july], '2026-06-30'))).toEqual(['2026']);
    expect(shown(freeReserveYears([short, july], '2026-08-15'))).toEqual(['2026 vorläufig', '2026-2']);
    const next = fy('2027', '2027-07-01', '2028-06-30');
    const r = freeReserveYears([next, july, short], '2027-07-10');
    expect(shown(r)).toEqual(['2026-2 vorläufig', '2027']);
    expect(r.defaultFiscalYearId).toBe('FY-2026-2');
  });

  it('without a year for the day shows the open year before it, and nothing without any year', () => {
    const r = freeReserveYears([calendar(2026)], '2027-01-05');
    expect(shown(r)).toEqual(['2026 vorläufig']);
    expect(r.defaultFiscalYearId).toBe('FY-2026');
    expect(freeReserveYears([], '2026-10-06')).toEqual({ years: [], defaultFiscalYearId: null });
  });
});
