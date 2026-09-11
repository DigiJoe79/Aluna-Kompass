import { getDocument, previewDraft } from '@kompass/module-dms';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const deps = getDeps();

  // Ist es bereits festgeschrieben oder eine abgelegte Datei, liefern wir die Datei.
  const filed = await getDocument(deps, session.ctx, id);
  if (filed.ok) {
    return new Response(Buffer.from(filed.value.bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${filed.value.filename}"`,
        'cache-control': 'private, max-age=3600',
        'content-length': String(filed.value.bytes.byteLength),
      },
    });
  }

  const result = await previewDraft(deps, session.ctx, { id });
  if (!result.ok) return new Response(null, { status: 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.value.filename}"`,
      'cache-control': 'no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
