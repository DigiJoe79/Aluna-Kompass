import { pdfPageCount } from '@kompass/documents';
import { isModuleEnabled } from '@kompass/core';
import { getDocument, previewDraft } from '@kompass/module-dms';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Die Seitenzahl reist im Kopf der Antwort mit: Im `<iframe>` kommt sie nicht
 * an, wer sie braucht, holt das PDF selbst. Ohne bekannte Zahl kein Kopf —
 * geraten wird nicht.
 */
const pageHeader = (pages: number | null): Record<string, string> =>
  pages ? { 'x-pages': String(pages) } : {};

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'dms')) return new Response(null, { status: 404 });

  // Ist es bereits festgeschrieben oder eine abgelegte Datei, liefern wir die Datei.
  const filed = await getDocument(deps, session.ctx, id);
  if (filed.ok) {
    return new Response(Buffer.from(filed.value.bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${filed.value.filename}"`,
        // Eine geschützte Datei bleibt nicht eine Stunde im Browser liegen: Wem
        // das Recht entzogen wird, der soll sie beim nächsten Klick nicht mehr sehen.
        'cache-control': filed.value.protected ? 'private, no-store' : 'private, max-age=3600',
        'content-length': String(filed.value.bytes.byteLength),
        ...pageHeader(pdfPageCount(filed.value.bytes)),
      },
    });
  }

  // Ein verändertes Dokument ist kein Entwurf: Ohne diesen Riegel fiele die
  // Vorschau auf den Entwurfs-Renderer zurück und zeigte etwas Frisches an der
  // Stelle, an der ein festgeschriebenes Schreiben stehen sollte.
  if (!filed.ok && filed.error.type === 'conflict' && filed.error.code === 'documentAltered') {
    return new Response(filed.error.message, { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const result = await previewDraft(deps, session.ctx, { id });
  if (!result.ok) return new Response(null, { status: 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.value.filename}"`,
      'cache-control': 'no-store',
      'content-length': String(result.value.bytes.byteLength),
      ...pageHeader(result.value.pages),
    },
  });
}
