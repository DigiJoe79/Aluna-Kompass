import { isModuleEnabled } from '@kompass/core';
import { directDebitFileStream } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { conflictText } from '@/lib/error-text';
import { optionalSession } from '@/lib/request-context';

/**
 * Die Datei eines Einzugs für die Bank (Plan U2, Global Constraints): GET `?kind=xml|csv` → pain.008 bzw. die CSV für
 * Lastschriftvorlagen als Download, `Lastschrift-{Fälligkeit}.xml`. Recht `finance.directDebit` prüft der Dienst; MCP gibt
 * die Datei nie heraus (sie enthält die IBAN jedes Zahlers). Nie zwischengespeichert.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const kind = new URL(request.url).searchParams.get('kind');
  const result = await directDebitFileStream(deps, session.ctx, { runId: id, kind });
  if (!result.ok) {
    const error = result.error;
    if (error.type === 'conflict') return Response.json({ code: error.code, message: conflictText(error, await getTranslations()) }, { status: 409, headers: { 'cache-control': 'private, no-store' } });
    return new Response(null, { status: error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'notFound' ? 404 : 401 });
  }
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': result.value.mimeType,
      'content-disposition': `attachment; filename="${result.value.fileName}"`,
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
