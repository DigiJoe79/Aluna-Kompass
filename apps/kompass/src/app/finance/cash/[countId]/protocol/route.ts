import { isModuleEnabled } from '@kompass/core';
import { readCashCountProtocol } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Das Zählprotokoll, immer über diesen Weg — nie ein direkter Akten-Link
 * (`/dms/[id]/file`): `finance.read` genügt, ohne `dms.view` (Muster
 * `entries/[id]/voucher/[documentId]/route.ts`).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ countId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { countId } = await ctx.params;
  const result = await readCashCountProtocol(deps, session.ctx, { countId });
  if (!result.ok) return new Response(null, { status: 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.value.filename}"`,
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
