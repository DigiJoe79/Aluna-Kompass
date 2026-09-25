import { isModuleEnabled } from '@kompass/core';
import { previewConfirmation } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Die Vorschau im Ausstellen-Dialog: POST mit JSON
 * `{ lineIds, issuedOn?, kind?, preNoticeReason? }` → PDF mit Wasserzeichen
 * und Nummer ENTWURF. `finance.donationsIssue`; kein Akteneintrag, kein
 * Protokoll, nie zwischengespeichert. Ein Fachfehler der Prüfliste kommt als
 * 409 mit `{ code, message }` zurück, damit der Dialog ihn nennen kann.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const result = await previewConfirmation(deps, session.ctx, input);
  if (!result.ok) {
    const error = result.error;
    if (error.type === 'conflict') return Response.json({ code: error.code, message: error.message }, { status: 409, headers: { 'cache-control': 'private, no-store' } });
    return new Response(null, { status: error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'notFound' ? 404 : 401 });
  }
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.value.filename}"`,
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
