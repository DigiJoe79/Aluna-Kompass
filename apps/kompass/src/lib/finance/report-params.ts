import type { ReportParams } from '@kompass/module-finance';

type Query = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

const isDay = (value: string | undefined): value is string => value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Berichte zu einem Stichtag statt zu einem Jahr (Rechenschaft B1): Die Adresse trägt nur `?date=`. */
export const DATE_REPORTS: readonly string[] = ['handoverList'];

/** Berichte je Erklärungszeitraum statt je Jahr (Rechenschaft D2, 15i): Die Adresse trägt nur `?period=`. */
export const PERIOD_REPORTS: readonly string[] = ['taxReturnGem', 'taxReturnIncomeStatement'];

/** E6b: Berichte je Umsatzsteuer-Zeitraum (Voranmeldung): Die Adresse trägt nur `?period=` mit `'YYYY-Qn'` bzw. `'YYYY-MM'`. */
export const VAT_PERIOD_REPORTS: readonly string[] = ['vatAdvanceReturn'];

/**
 * Berichte über mehrere Jahre, die außer `?year=` auch `?period=` verstehen (Befund 18 d): Die Jahre des
 * Erklärungszeitraums werden zu `fiscalYearIds` — die Fassung, die die Beilage der Steuererklärung meint.
 */
export const PERIOD_SPAN_REPORTS: readonly string[] = ['reserveStatement'];

/**
 * Die Parameter eines Berichts aus der Adresse — eine Stelle für Seite, Vorschau-Route und Aktion, damit alle drei
 * denselben kanonischen Hash bilden. Die Oberfläche kennt das Jahr (`?year=`), bei der EÜR die zusammengefasste
 * Darstellung (`?combine=1`), bei der Projektabrechnung das Projekt (`?project=`) und bei der Übergabeliste statt des
 * Jahres den Stichtag (`?date=`, Vorgabe `defaults.today`), bei den Steuerberichten statt des Jahres den
 * Erklärungszeitraum (`?period=`), beim Rücklagenspiegel mit `?period=` die Jahre des Zeitraums (`defaults.periodYearIds`;
 * ein unbekannter Zeitraum ergibt keine Parameter); Vorgaben fehlen (`combineOperations: false` steht nie
 * drin), sonst hätte dieselbe Fassung zwei Parametertexte.
 */
export function reportParamsFromQuery(key: string, query: Query, defaultYearId: string, defaults: { today?: string; periodYearIds?: (periodId: string) => readonly string[] | null } = {}): ReportParams {
  const date = first(query.date);
  const spanPeriod = PERIOD_SPAN_REPORTS.includes(key) ? first(query.period) : undefined;
  if (spanPeriod) {
    const ids = defaults.periodYearIds?.(spanPeriod);
    return ids && ids.length > 0 ? { fiscalYearIds: [...ids] } : {};
  }
  if (VAT_PERIOD_REPORTS.includes(key)) {
    const period = first(query.period);
    return period ? { vatPeriod: period } : {};
  }
  if (PERIOD_REPORTS.includes(key)) {
    const period = first(query.period);
    return period ? { taxPeriodId: period } : {};
  }
  if (DATE_REPORTS.includes(key)) {
    const day = isDay(date) ? date : defaults.today;
    return day ? { date: day } : {};
  }
  const params: ReportParams = { fiscalYearId: first(query.year) || defaultYearId };
  if (key === 'incomeStatement' && first(query.combine) === '1') params.combineOperations = true;
  const project = first(query.project);
  if (key === 'projectStatement' && project) params.projectId = project;
  // Der Kassenbericht als Zwischenbericht bis zu einem Stichtag (Amtsübergabe, Plan C2 Task 8).
  if (key === 'cashReport' && isDay(date)) params.date = date;
  return params;
}

/**
 * Die Gegenrichtung für Links und Routen: `year=…`, bei der EÜR `&combine=1`, bei der Projektabrechnung `&project=…`;
 * Jahre eines Erklärungszeitraums (`opts.periodId`) als `period=…`.
 */
export function reportQuery(params: ReportParams, opts: { periodId?: string } = {}): string {
  const query = new URLSearchParams();
  if (opts.periodId && params.fiscalYearIds) {
    query.set('period', opts.periodId);
    return query.toString();
  }
  if (params.fiscalYearId) query.set('year', params.fiscalYearId);
  if (params.combineOperations) query.set('combine', '1');
  if (params.projectId) query.set('project', params.projectId);
  if (params.date) query.set('date', params.date);
  if (params.taxPeriodId) query.set('period', params.taxPeriodId);
  if (params.vatPeriod) query.set('period', params.vatPeriod);
  return query.toString();
}

/** Vorgabe-Jahr der Berichte: das jüngste abgeschlossene Geschäftsjahr, sonst das laufende (Plan A3). */
export function defaultReportYearId(years: readonly { id: string; endsOn: string; status: string }[], today: string): string | null {
  const byEnd = [...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn));
  const closed = byEnd.find((y) => y.status === 'closed');
  if (closed) return closed.id;
  const running = [...byEnd].reverse().find((y) => y.endsOn >= today);
  return running?.id ?? byEnd[0]?.id ?? null;
}
