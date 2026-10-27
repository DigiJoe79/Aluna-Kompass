import { isModuleEnabled } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { documentPageImage } from '@/lib/finance/report-pages';
import { pageImageResponse } from '@/lib/page-image-response';
import { optionalSession } from '@/lib/request-context';

/**
 * Seite `n` eines Dokuments der Akte als PNG für `PdfPages` — der unterschriebene Scan des Prüfberichts (Designer
 * Runde 7, 16e). Rechte wie das Dokument (`getDocument`, wie `../../file/route.ts`).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'dms')) return new Response(null, { status: 404 });
  const { id, n } = await ctx.params;
  return pageImageResponse(request, n, (page, scale) => documentPageImage(deps, session.ctx, id, page, scale));
}
