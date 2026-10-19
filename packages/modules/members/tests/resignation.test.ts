import { describe, expect, it } from 'vitest';
import { proposeResignationEnd } from '../src/resignation';

describe('proposeResignationEnd', () => {
  it('takes the first day on the anchor after the notice period', () => {
    expect(proposeResignationEnd('2026-09-30', { months: 3, at: 'fiscalYearEnd' })).toBe('2026-12-31');
    expect(proposeResignationEnd('2026-10-15', { months: 3, at: 'quarterEnd' })).toBe('2027-03-31');
    expect(proposeResignationEnd('2026-10-01', { months: 3, at: 'fiscalYearEnd' })).toBe('2027-12-31');
    expect(proposeResignationEnd('2026-10-15', { months: 1, at: 'monthEnd' })).toBe('2026-11-30');
  });

  it('without period and anchor it is the notice day itself', () => {
    expect(proposeResignationEnd('2026-10-15', { months: 0, at: 'any' })).toBe('2026-10-15');
  });

  it('a period ending on a shorter month stays in that month', () => {
    expect(proposeResignationEnd('2026-11-30', { months: 3, at: 'any' })).toBe('2027-02-28');
    expect(proposeResignationEnd('2026-11-30', { months: 3, at: 'monthEnd' })).toBe('2027-02-28');
    expect(proposeResignationEnd('2026-12-31', { months: 0, at: 'quarterEnd' })).toBe('2026-12-31');
  });
});
