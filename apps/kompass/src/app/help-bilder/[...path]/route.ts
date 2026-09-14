import { readHandbookAsset } from '@kompass/core';
import { runtimeEnv } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { path } = await ctx.params;
  const asset = readHandbookAsset(runtimeEnv(), path.join('/'));
  if (!asset) return new Response(null, { status: 404 });
  return new Response(Buffer.from(asset.bytes), {
    headers: {
      'content-type': asset.mimeType,
      'cache-control': 'private, max-age=3600',
      'content-length': String(asset.bytes.byteLength),
      // Wie /media: ein SVG ist ein Dokument; die Sandbox nimmt ihm die Rechte des Ursprungs.
      'content-security-policy': 'sandbox',
      'x-content-type-options': 'nosniff',
    },
  });
}
