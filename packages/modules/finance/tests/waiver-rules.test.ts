import { describe, expect, it } from 'vitest';
import { waiverDeadline, waiverIsTimely } from '../src/allocation/waiver-rules';
import { DATED_SERIES } from '../src/ledger/dated-series';

/**
 * Frist des Verzichts (F8a Annahme 9, BMF 25.11.2014 i. d. F. 24.08.2016,
 * EStH Anhang 37 III): bei einmaligen Ansprüchen binnen drei Monaten, bei
 * regelmäßigen binnen eines Jahres nach Fälligkeit; Fälligkeit = Positionsdatum.
 */
const MONTHS = { claimMonths: 12, oneOffMonths: 3 };

describe('the shipped waiver deadlines', () => {
  it('are three months for one-off claims and twelve for recurring claims', () => {
    expect(DATED_SERIES.waiverOneOffMonths).toEqual({ unit: 'months', series: [{ validFrom: '2026-01-01', value: 3 }] });
    expect(DATED_SERIES.waiverClaimMonths).toEqual({ unit: 'months', series: [{ validFrom: '2026-01-01', value: 12 }] });
  });
});

describe('waiverDeadline', () => {
  it('adds three months to a one-off claim and twelve to a recurring one', () => {
    expect(waiverDeadline('2026-03-15', false, MONTHS)).toBe('2026-06-15');
    expect(waiverDeadline('2026-03-15', true, MONTHS)).toBe('2027-03-15');
  });

  it('ends on the last day of a shorter month, also in a leap year', () => {
    expect(waiverDeadline('2026-11-30', false, MONTHS)).toBe('2027-02-28');
    expect(waiverDeadline('2027-11-30', false, MONTHS)).toBe('2028-02-29');
    expect(waiverDeadline('2028-02-29', true, MONTHS)).toBe('2029-02-28');
    expect(waiverDeadline('2026-10-31', false, MONTHS)).toBe('2027-01-31');
  });

  it('takes the months it is given — an override of the association counts', () => {
    expect(waiverDeadline('2026-03-15', false, { claimMonths: 12, oneOffMonths: 6 })).toBe('2026-09-15');
  });

  it('refuses a malformed date', () => {
    expect(() => waiverDeadline('15.03.2026', false, MONTHS)).toThrow(RangeError);
  });
});

describe('waiverIsTimely', () => {
  it('is timely up to and including the deadline, late from the day after', () => {
    expect(waiverIsTimely('2026-06-14', '2026-06-15')).toBe(true);
    expect(waiverIsTimely('2026-06-15', '2026-06-15')).toBe(true);
    expect(waiverIsTimely('2026-06-16', '2026-06-15')).toBe(false);
  });
});
