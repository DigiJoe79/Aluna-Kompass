import { getMediaPreview } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/** Die Vorschau eines Assets — Rechte wie das Original, Cache-Datei wird bei Bedarf gebaut. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const result = await getMediaPreview(getDeps(), session.ctx, id);
  if (!result.ok || result.value.bytes === null) return new Response(null, { status: 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': result.value.contentType,
      'cache-control': 'private, max-age=3600',
      'content-length': String(result.value.bytes.byteLength),
      'content-security-policy': 'sandbox',
      'x-content-type-options': 'nosniff',
    },
  });
}
