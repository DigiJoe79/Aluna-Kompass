import { isModuleEnabled } from '@kompass/core';
import { readVoucher } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Der Beleg selbst, immer über diesen Weg — nie ein direkter Akten-Link
 * (`/dms/[id]/file`): Die Schatzmeisterin liest Belege über `finance.read`,
 * ohne `dms.view` zu brauchen (Global Constraint des Plans, Muster der Akte).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; documentId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { id, documentId } = await ctx.params;
  const result = await readVoucher(deps, session.ctx, { entryId: id, documentId });
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
