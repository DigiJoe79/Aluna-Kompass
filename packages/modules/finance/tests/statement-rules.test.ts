import { describe, expect, it } from 'vitest';
import { statementCoversYearEnd, suggestPeriodFromText } from '../src/ledger/statement-rules';

describe('statementCoversYearEnd', () => {
  it('covers the year end when the statement runs to it', () => {
    expect(statementCoversYearEnd('2025-12-31', '2025-12-31', null)).toBe(true);
    expect(statementCoversYearEnd('2026-01-10', '2025-12-31', '2025-12-31')).toBe(true);
  });

  it('covers it from the last month when nothing moved afterwards', () => {
    expect(statementCoversYearEnd('2025-12-30', '2025-12-31', '2025-12-29')).toBe(true);
    expect(statementCoversYearEnd('2025-12-30', '2025-12-31', null)).toBe(true);
  });

  it('does not cover it with a movement after the statement or before the last month', () => {
    expect(statementCoversYearEnd('2025-12-30', '2025-12-31', '2025-12-31')).toBe(false);
    expect(statementCoversYearEnd('2025-11-30', '2025-12-31', '2025-11-30')).toBe(false);
  });
});

describe('suggestPeriodFromText', () => {
  it('reads a period „vom … bis …“', () => {
    expect(suggestPeriodFromText('Kontoauszug 12/2025 vom 01.12.2025 bis 31.12.2025 Seite 1')).toEqual({ periodFrom: '2025-12-01', periodTo: '2025-12-31' });
    expect(suggestPeriodFromText('Zeitraum 01.11.2025 – 30.11.2025')).toEqual({ periodFrom: '2025-11-01', periodTo: '2025-11-30' });
  });

  it('takes the latest date as the end without a range', () => {
    expect(suggestPeriodFromText('Buchung 03.12.2025\nBuchung 29.12.2025\nErstellt 02.12.2025')).toEqual({ periodFrom: null, periodTo: '2025-12-29' });
  });

  it('gives nothing without a date', () => {
    expect(suggestPeriodFromText('Kein Datum hier, 12/2025')).toBeNull();
    expect(suggestPeriodFromText('31.02.2025')).toBeNull();
  });
});
