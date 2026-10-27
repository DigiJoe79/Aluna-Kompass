import { isModuleEnabled } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { versionPageImage } from '@/lib/finance/report-pages';
import { pageImageResponse } from '@/lib/page-image-response';
import { optionalSession } from '@/lib/request-context';

/**
 * Seite `n` einer festgeschriebenen Fassung als PNG für `PdfPages` (Designer Runde 7, 16a C): die Datei aus der Akte,
 * nie ein neu erzeugtes PDF — mit den Rechten des Dokuments wie `../../file/route.ts`.
 */
export async function GET(request: Request, ctx: { params: Promise<{ reportId: string; n: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { reportId, n } = await ctx.params;
  return pageImageResponse(request, n, (page, scale) => versionPageImage(deps, session.ctx, reportId, page, scale));
}
