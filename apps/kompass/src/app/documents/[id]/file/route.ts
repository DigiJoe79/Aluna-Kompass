import { getDocument } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const result = await getDocument(getDeps(), session.ctx, id);
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${result.value.filename}"`, 'cache-control': 'private, no-store' },
  });
}
