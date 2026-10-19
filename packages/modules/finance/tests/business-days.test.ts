import { describe, expect, it } from 'vitest';
import { addBusinessDays, easterSunday, isTargetBusinessDay } from '../src/direct-debit/business-days';

/** Plan L1 Task 1 — TARGET2-Kalender: Wochenende, 1.1., Karfreitag, Ostermontag, 1.5., 25.12., 26.12. */
describe('TARGET2 business days', () => {
  it('computes Easter (Gauß/anonymous algorithm)', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2038)).toBe('2038-04-25');
  });

  it('Good Friday and Easter Monday 2027 are no business days, the days around them are', () => {
    expect(isTargetBusinessDay('2027-03-26')).toBe(false);
    expect(isTargetBusinessDay('2027-03-29')).toBe(false);
    expect(isTargetBusinessDay('2027-03-25')).toBe(true);
    expect(isTargetBusinessDay('2027-03-30')).toBe(true);
  });

  it('weekends and the fixed holidays are closed', () => {
    for (const day of ['2026-10-17', '2026-10-18', '2027-01-01', '2026-05-01', '2026-12-25', '2026-12-26']) expect(isTargetBusinessDay(day), day).toBe(false);
    // Kein TARGET2-Feiertag: der 3. Oktober und der 24. Dezember.
    expect(isTargetBusinessDay('2025-10-03')).toBe(true);
    expect(isTargetBusinessDay('2026-12-24')).toBe(true);
  });

  it('adds business days forwards and backwards', () => {
    expect(addBusinessDays('2026-12-23', 2)).toBe('2026-12-28');
    expect(addBusinessDays('2026-12-28', -2)).toBe('2026-12-23');
    expect(addBusinessDays('2026-10-16', 1)).toBe('2026-10-19');
    expect(addBusinessDays('2026-10-19', 0)).toBe('2026-10-19');
    expect(addBusinessDays('2027-03-31', -2)).toBe('2027-03-25');
  });
});
