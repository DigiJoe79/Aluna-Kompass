import { describe, expect, it } from 'vitest';
import { defaultReportYearId, reportParamsFromQuery, reportQuery } from '@/lib/finance/report-params';

/** Ein Helfer für Seite, Route und Aktion: dieselben Parameter, derselbe kanonische Hash (Plan A3, Global Constraints). */
describe('reportParamsFromQuery', () => {
  it('reads the year and leaves defaults out', () => {
    expect(reportParamsFromQuery('incomeStatement', { year: 'y1' }, 'y0')).toEqual({ fiscalYearId: 'y1' });
    expect(reportParamsFromQuery('incomeStatement', { year: 'y1', combine: '1' }, 'y0')).toEqual({ fiscalYearId: 'y1', combineOperations: true });
    expect(reportParamsFromQuery('incomeStatement', { year: 'y1', combine: '0' }, 'y0')).toEqual({ fiscalYearId: 'y1' });
    expect(reportParamsFromQuery('cashReport', {}, 'y0')).toEqual({ fiscalYearId: 'y0' });
    expect(reportParamsFromQuery('cashReport', { year: 'y1', combine: '1' }, 'y0')).toEqual({ fiscalYearId: 'y1' });
    expect(reportParamsFromQuery('cashReport', { year: ['y2', 'y3'] }, 'y0')).toEqual({ fiscalYearId: 'y2' });
  });

  it('Kassenbericht als Zwischenbericht bis zu einem Stichtag (Amtsübergabe): `date` nur als gültiger Tag', () => {
    expect(reportParamsFromQuery('cashReport', { year: 'y1', date: '2026-06-30' }, 'y0')).toEqual({ fiscalYearId: 'y1', date: '2026-06-30' });
    expect(reportParamsFromQuery('cashReport', { year: 'y1', date: '30.06.2026' }, 'y0')).toEqual({ fiscalYearId: 'y1' });
    expect(reportParamsFromQuery('incomeStatement', { year: 'y1', date: '2026-06-30' }, 'y0')).toEqual({ fiscalYearId: 'y1' });
    expect(reportQuery({ fiscalYearId: 'y1', date: '2026-06-30' })).toBe('year=y1&date=2026-06-30');
  });

  it('reads the tax return period of both tax reports (Rechenschaft D2, 15i)', () => {
    expect(reportParamsFromQuery('taxReturnIncomeStatement', { period: 'P', year: 'y1' }, 'y0')).toEqual({ taxPeriodId: 'P' });
    expect(reportParamsFromQuery('taxReturnGem', { period: 'P' }, 'y0')).toEqual({ taxPeriodId: 'P' });
    expect(reportParamsFromQuery('taxReturnGem', {}, 'y0')).toEqual({});
    expect(reportParamsFromQuery('incomeStatement', { year: 'y1', period: 'P' }, 'y0')).toEqual({ fiscalYearId: 'y1' });
    expect(reportQuery({ taxPeriodId: 'P' })).toBe('period=P');
  });

  it('reads the tax return period of the reserve statement as its years (Befund 18d)', () => {
    const periodYearIds = (id: string) => (id === 'P' ? ['y1', 'y2'] : null);
    expect(reportParamsFromQuery('reserveStatement', { period: 'P', year: 'y0' }, 'y0', { periodYearIds })).toEqual({ fiscalYearIds: ['y1', 'y2'] });
    // Ohne Zeitraum wie bisher je Geschäftsjahr; ein unbekannter Zeitraum ergibt keine Parameter (wie bei den Steuerberichten).
    expect(reportParamsFromQuery('reserveStatement', { year: 'y1' }, 'y0', { periodYearIds })).toEqual({ fiscalYearId: 'y1' });
    expect(reportParamsFromQuery('reserveStatement', { period: 'NOPE' }, 'y0', { periodYearIds })).toEqual({});
    expect(reportParamsFromQuery('assetOverview', { period: 'P', year: 'y1' }, 'y0', { periodYearIds })).toEqual({ fiscalYearId: 'y1' });
    // Zurück in die Adresse: die Jahre des Zeitraums als `?period=`.
    expect(reportQuery({ fiscalYearIds: ['y1', 'y2'] }, { periodId: 'P' })).toBe('period=P');
  });

  it('reads the project of the project statement and the day of the handover list (Rechenschaft B1)', () => {
    expect(reportParamsFromQuery('projectStatement', { year: 'y1', project: 'p1' }, 'y0')).toEqual({ fiscalYearId: 'y1', projectId: 'p1' });
    expect(reportParamsFromQuery('projectStatement', { year: 'y1' }, 'y0')).toEqual({ fiscalYearId: 'y1' });
    expect(reportParamsFromQuery('handoverList', { date: '2026-10-24' }, 'y0')).toEqual({ date: '2026-10-24' });
    expect(reportParamsFromQuery('handoverList', {}, 'y0', { today: '2026-10-24' })).toEqual({ date: '2026-10-24' });
    expect(reportParamsFromQuery('handoverList', { date: 'gestern', year: 'y1' }, 'y0', { today: '2026-10-24' })).toEqual({ date: '2026-10-24' });
    expect(reportParamsFromQuery('incomeStatement', { year: 'y1', project: 'p1' }, 'y0')).toEqual({ fiscalYearId: 'y1' });
    expect(reportQuery({ fiscalYearId: 'y1', projectId: 'p1' })).toBe('year=y1&project=p1');
    expect(reportQuery({ date: '2026-10-24' })).toBe('date=2026-10-24');
  });

  it('writes the same params back into the address', () => {
    expect(reportQuery({ fiscalYearId: 'y1' })).toBe('year=y1');
    expect(reportQuery({ fiscalYearId: 'y1', combineOperations: true })).toBe('year=y1&combine=1');
  });
});

describe('defaultReportYearId', () => {
  const y = (id: string, endsOn: string, status: 'open' | 'closed') => ({ id, endsOn, status });
  it('takes the newest closed year, else the running one', () => {
    expect(defaultReportYearId([y('a', '2024-12-31', 'closed'), y('b', '2025-12-31', 'closed'), y('c', '2026-12-31', 'open')], '2026-10-24')).toBe('b');
    expect(defaultReportYearId([y('c', '2026-12-31', 'open'), y('d', '2027-12-31', 'open')], '2026-10-24')).toBe('c');
    expect(defaultReportYearId([], '2026-10-24')).toBeNull();
  });
});
