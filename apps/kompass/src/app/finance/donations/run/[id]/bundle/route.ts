import { isModuleEnabled } from '@kompass/core';
import { readRunBundle } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Sammel-PDF eines Serienlaufs zum Drucken: GET `?part=machine|signature`
 * → die Exemplare des Teils in einem PDF, als Download. `finance.read`;
 * nichts wird abgelegt, nie zwischengespeichert. Ein Fachfehler (kein
 * ausgestelltes Exemplar im Teil, `pdfunite` fehlt) kommt als 409 mit
 * `{ code, message }` zurück, damit die Seite die Abhilfe nennen kann.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const part = new URL(request.url).searchParams.get('part');
  const result = await readRunBundle(deps, session.ctx, { runId: id, part });
  if (!result.ok) {
    const error = result.error;
    if (error.type === 'conflict') return Response.json({ code: error.code, message: error.message }, { status: 409, headers: { 'cache-control': 'private, no-store' } });
    return new Response(null, { status: error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'notFound' ? 404 : 401 });
  }
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${result.value.filename}"`,
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
