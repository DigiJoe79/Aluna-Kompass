import { isModuleEnabled, type ServiceError } from '@kompass/core';
import { listFiscalYears, previewFinanceReport, reportDefinition, type ReportStage } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { toActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { reportParamsForRoute } from '@/lib/finance/report-period';
import { optionalSession } from '@/lib/request-context';

/** Der Teil des Dateinamens zur Stufe — ein Wort ohne Umlaut, wie es auf dem Datenträger steht. */
const STAGE_SLUG: Record<ReportStage, string> = { preliminary: 'vorlaeufig', review: 'pruefung', final: 'festgeschrieben' };

/** „Einnahmen-Überschuss-Rechnung“ → „einnahmen-ueberschuss-rechnung“. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function statusOf(error: ServiceError): number {
  if (error.type === 'forbidden') return 403;
  if (error.type === 'unauthorized') return 401;
  if (error.type === 'notFound') return 404;
  if (error.type === 'conflict' && (error.code === 'reportUnknown' || error.code === 'reportUnavailable')) return 404;
  return 409;
}

/**
 * Die Vorschau eines Berichts als PDF in der Stufe, die der Zustand ergibt (Rechenschaft A3): für den Rahmen der
 * Detailseite, „PDF öffnen“ und, mit `?download=1`, „Herunterladen“. Parameter über `reportParamsFromQuery` wie Seite
 * und Aktion — derselbe Hash. Eine fachliche Ablehnung kommt als 409 mit `{ code, message }`.
 */
export async function GET(request: Request, ctx: { params: Promise<{ key: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { key } = await ctx.params;
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const years = await listFiscalYears(deps, session.ctx);
  if (!years.ok) return new Response(null, { status: statusOf(years.error) });
  const params = await reportParamsForRoute(deps, session.ctx, key, query);
  if (!params) return new Response(null, { status: 404 });
  const result = await previewFinanceReport(deps, session.ctx, { report: key, params });
  if (!result.ok) {
    const status = statusOf(result.error);
    if (status !== 409) return new Response(null, { status });
    const t = await getTranslations();
    const state = toActionState(result, t);
    return Response.json({ code: result.error.type === 'conflict' ? result.error.code : result.error.type, message: state.status === 'error' ? state.message : '' }, { status, headers: { 'cache-control': 'private, no-store' } });
  }
  const def = reportDefinition(key)!;
  const designation = years.value.find((y) => y.id === (params.fiscalYearId ?? params.fiscalYearIds?.at(-1)))?.designation ?? '';
  const filename = `${[slug(def.paperTitle), designation, STAGE_SLUG[result.value.stage]].filter(Boolean).join('-')}.pdf`;
  const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${disposition}; filename="${filename}"`,
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
