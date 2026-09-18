import { getDocument } from '@kompass/module-dms';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const result = await getDocument(getDeps(), session.ctx, id);
  if (!result.ok) {
    // Ein Dokument, dessen Datei nicht mehr zu seiner Prüfsumme passt, ist
    // nicht „nicht gefunden“ — es ist da, und genau das ist das Problem. 409
    // sagt das, und der Text erklärt es dem, der auf den Link geklickt hat.
    if (result.error.type === 'conflict' && result.error.code === 'documentAltered') {
      return new Response(result.error.message, { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return new Response(null, { status: 404 });
  }
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.value.filename}"`,
      'cache-control': 'private, max-age=3600',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
