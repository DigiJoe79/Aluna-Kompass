import { getMediaAsset } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const result = await getMediaAsset(getDeps(), session.ctx, id);
  if (!result.ok) return new Response(null, { status: 404 });
  return new Response(Buffer.from(result.value.bytes), { headers: { 'content-type': result.value.record.mimeType, 'cache-control': 'private, max-age=3600', 'content-length': String(result.value.bytes.byteLength) } });
}
