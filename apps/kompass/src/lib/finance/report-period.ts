import { todayIn, type CallContext, type Deps } from '@kompass/core';
import { listTaxPeriods, type ReportParams } from '@kompass/module-finance';
import { PERIOD_SPAN_REPORTS, reportParamsFromQuery } from './report-params';

type Query = Record<string, string | string[] | undefined>;

/**
 * Die Jahre je Erklärungszeitraum über den Dienst (`finance.read`), für `reportParamsFromQuery` — nur geladen, wenn ein
 * Bericht über mehrere Jahre `?period=` trägt (Befund 18 d). Ohne Leserecht kennt sie keinen Zeitraum.
 */
export async function periodYearIdsLookup(deps: Deps, ctx: CallContext, key: string, query: Query): Promise<((periodId: string) => readonly string[] | null) | undefined> {
  if (!PERIOD_SPAN_REPORTS.includes(key) || !query.period) return undefined;
  const periods = await listTaxPeriods(deps, ctx, {});
  const byId = new Map((periods.ok ? periods.value : []).map((p) => [p.id, p.fiscalYearIds] as const));
  return (periodId) => byId.get(periodId) ?? null;
}

/**
 * Die Parameter einer Vorschau- oder Seitenbild-Route aus der Adresse, wie die Detailseite sie bildet; `null`, wenn ein
 * Bericht über mehrere Jahre einen unbekannten Zeitraum nennt (→ 404 wie bei den Steuerberichten).
 */
export async function reportParamsForRoute(deps: Deps, ctx: CallContext, key: string, query: Query): Promise<ReportParams | null> {
  const periodYearIds = await periodYearIdsLookup(deps, ctx, key, query);
  const params = reportParamsFromQuery(key, query, '', { today: todayIn(deps), periodYearIds });
  if (periodYearIds && !params.fiscalYearIds) return null;
  return params;
}
