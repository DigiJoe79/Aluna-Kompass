import { isModuleEnabled } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { reportPageImage } from '@/lib/finance/report-pages';
import { reportParamsForRoute } from '@/lib/finance/report-period';
import { pageImageResponse } from '@/lib/page-image-response';
import { optionalSession } from '@/lib/request-context';

/**
 * Seite `n` eines Berichts als PNG für `PdfPages` (Designer Runde 6, Punkt 4) — mit denselben Rechten und Parametern
 * wie die Vorschau als PDF (`../../preview/route.ts`). `?scale=2` liefert die doppelte Dichte fürs `srcset`. Eine
 * Seitenzahl außerhalb, keine Zahl oder eine unbekannte Dichte → 404. Die Seitenzahl des Berichts steht in
 * `x-page-count`.
 */
export async function GET(request: Request, ctx: { params: Promise<{ key: string; n: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { key, n } = await ctx.params;
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  const params = await reportParamsForRoute(deps, session.ctx, key, query);
  if (!params) return new Response(null, { status: 404 });
  return pageImageResponse(request, n, (page, scale) => reportPageImage(deps, session.ctx, key, params, page, scale));
}
