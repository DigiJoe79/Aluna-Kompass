import { isModuleEnabled } from '@kompass/core';
import { readFinanceReportDocument } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Die Datei einer festgeschriebenen Fassung, auch zurückgenommen — über den Bezug als Berechtigung der Akte, nie ein
 * direkter Akten-Link (Muster `cash/[countId]/protocol/route.ts`).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ reportId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { reportId } = await ctx.params;
  const result = await readFinanceReportDocument(deps, session.ctx, { reportId });
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : result.error.type === 'notFound' ? 404 : 409 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.value.filename}"`,
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
