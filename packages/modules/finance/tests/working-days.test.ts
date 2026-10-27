import { describe, expect, it } from 'vitest';
import { easterSunday, nextWorkingDay, publicHolidays } from '../src/ledger/working-days';

/** Plan E6a Task 1 — § 108 Abs. 3 AO: Fristende am nächsten Werktag. */
describe('working days', () => {
  it('computes Easter', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2024)).toBe('2024-03-31');
  });

  it('moves to the next working day', () => {
    expect(nextWorkingDay('2027-07-31')).toBe('2027-08-02');
    expect(nextWorkingDay('2027-02-28')).toBe('2027-03-01');
    expect(nextWorkingDay('2026-04-03')).toBe('2026-04-07');
    expect(nextWorkingDay('2026-12-25')).toBe('2026-12-28');
    expect(nextWorkingDay('2026-07-10')).toBe('2026-07-10');
    expect(nextWorkingDay('2026-05-14')).toBe('2026-05-15');
  });

  it('knows state holidays only with a state', () => {
    expect(nextWorkingDay('2026-06-04')).toBe('2026-06-04');
    expect(nextWorkingDay('2026-06-04', 'NW')).toBe('2026-06-05');
    expect(nextWorkingDay('2025-10-31', 'NI')).toBe('2025-11-03');
    expect(nextWorkingDay('2017-10-31')).toBe('2017-11-01');
    expect(nextWorkingDay('2018-10-31', 'NI')).toBe('2018-11-01');
    expect(nextWorkingDay('2017-10-31', 'NI')).toBe('2017-11-01');
    expect(nextWorkingDay('2026-11-18', 'SN')).toBe('2026-11-19');
    expect(nextWorkingDay('2026-11-18')).toBe('2026-11-18');
  });

  it('lists the nationwide holidays sorted and without duplicates', () => {
    const days = publicHolidays(2026);
    expect(days).toHaveLength(9);
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });
});
