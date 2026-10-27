import { describe, expect, it } from 'vitest';
import { parseVatPeriod, vatFilingOpensOn, vatPeriodOf, vatTaxPointOn } from '../src/ledger/vat-calendar';

/** Plan E6a Task 11a — die reinen Zeitraumfunktionen, auch im Browser (`@kompass/module-finance/vat-calendar`). */
describe('VAT calendar', () => {
  it('takes the tax point from the service date, never after the booking', () => {
    expect(vatTaxPointOn({ taxCode: 'rc13bEu', entryDate: '2026-04-10', serviceDate: '2026-03-20' })).toBe('2026-03-20');
    expect(vatTaxPointOn({ taxCode: 'rc13bEu', entryDate: '2026-06-15', serviceDate: '2026-07-01' })).toBe('2026-06-15');
    expect(vatTaxPointOn({ taxCode: 'standard', entryDate: '2026-06-15', serviceDate: '2026-05-01' })).toBe('2026-06-15');
  });

  it('builds the period of a day', () => {
    expect(vatPeriodOf('2026-05-12', 'quarter')).toEqual({ key: '2026-Q2', kind: 'quarter', startsOn: '2026-04-01', endsOn: '2026-06-30' });
    expect(vatPeriodOf('2026-02-12', 'month')).toEqual({ key: '2026-02', kind: 'month', startsOn: '2026-02-01', endsOn: '2026-02-28' });
  });

  it('parses period keys', () => {
    expect(parseVatPeriod('2026')).toEqual({ key: '2026', kind: 'year', startsOn: '2026-01-01', endsOn: '2026-12-31' });
    expect(parseVatPeriod('2026-Q4')).toMatchObject({ startsOn: '2026-10-01', endsOn: '2026-12-31' });
    expect(parseVatPeriod('2026-Q5')).toBeNull();
  });

  it('opens the filing the day after the period ends', () => {
    expect(vatFilingOpensOn('2026-Q3')).toBe('2026-10-01');
    expect(vatFilingOpensOn('2026-12')).toBe('2027-01-01');
    expect(vatFilingOpensOn('2026-02')).toBe('2026-03-01');
    expect(vatFilingOpensOn('2026')).toBe('2027-01-01');
    expect(vatFilingOpensOn('nonsense')).toBeNull();
  });
});
