import { isModuleEnabled } from '@kompass/core';
import { readConfirmationCopy } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Unser Exemplar einer Zuwendungsbestätigung als PDF — `finance.read` über
 * den Bezug der Akte, ohne `dms.view`; auch nach der Rücknahme (Muster
 * `cash/[countId]/protocol/route.ts`).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const result = await readConfirmationCopy(deps, session.ctx, { id });
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.value.filename}"`,
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
