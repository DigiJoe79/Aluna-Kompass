import { readProposalImage } from '@kompass/module-animals';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/** Bilder eines Vorschlags vor der Entscheidung (Spec Vorschläge § 7): nur `animals.manage`, Vorgabe die WebP-Vorschau. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const variant = new URL(request.url).searchParams.get('variant') === 'original' ? 'original' : 'preview';
  const result = await readProposalImage(getDeps(), session.ctx, { imageId: id, variant });
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : 404 });
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
