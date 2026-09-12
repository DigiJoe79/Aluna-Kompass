import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from '@/lib/dates';

describe('formatDate', () => {
  it('zeigt ein ISO-Datum aus der Sprache heraus — bei Deutsch mit Punkten', () => {
    expect(formatDate('2026-09-12', 'locale')).toBe('12.09.2026');
    expect(formatDate('2026-09-12', 'locale', 'en-GB')).toBe('12/09/2026');
  });

  it('lässt ISO 8601 stehen, wenn das eingestellt ist', () => {
    expect(formatDate('2026-09-12', 'iso')).toBe('2026-09-12');
  });

  it('nimmt von einem Zeitstempel nur den Tag, und verschiebt ihn nicht über die Zeitzone', () => {
    expect(formatDate('2026-09-12T23:30:00.000Z', 'locale')).toBe('12.09.2026');
    expect(formatDate('2026-01-01', 'locale')).toBe('01.01.2026');
  });

  it('gibt bei nichts nichts zurück', () => {
    expect(formatDate(null, 'locale')).toBe('');
    expect(formatDate('', 'iso')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('zeigt Datum und Uhrzeit in der Zeitzone des Vereins', () => {
    expect(formatDateTime('2026-09-12T15:35:00.000Z', 'locale')).toBe('12.09.2026, 17:35');
    expect(formatDateTime('2026-09-12T15:35:00.000Z', 'iso')).toBe('2026-09-12 17:35');
  });

  it('lässt Unlesbares unverändert', () => {
    expect(formatDateTime('kaputt', 'locale')).toBe('kaputt');
  });
});
