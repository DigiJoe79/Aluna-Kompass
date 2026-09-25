import { isModuleEnabled } from '@kompass/core';
import { readFacsimile } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Das Faksimile eines Unterzeichners (`?signerId=…`) — nur mit
 * `finance.donationsIssue`, nie zwischengespeichert. Der einzige Weg, auf dem
 * die Bytes einer Unterschrift das Modul verlassen: kein MCP, keine
 * Mediathek (F6a Annahme 8; Muster `cash/[countId]/protocol/route.ts`).
 */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const signerId = new URL(request.url).searchParams.get('signerId') ?? '';
  const result = await readFacsimile(deps, session.ctx, { signerId });
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : result.error.type === 'validation' ? 400 : 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': result.value.mimeType,
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
      'x-content-type-options': 'nosniff',
    },
  });
}
