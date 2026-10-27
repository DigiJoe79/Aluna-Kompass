import type { ServiceError } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { toActionState } from '@/lib/actions';

/**
 * Antworten der Routen der Kassenprüfung (Plan D1b Task 2): Rechte 403, Unbekanntes 404, eine fachliche Ablehnung 409
 * mit `{ code, message }` — die Oberfläche zeigt den Satz über dem Knopf.
 */
export async function auditRefusal(error: ServiceError): Promise<Response> {
  if (error.type === 'forbidden') return new Response(null, { status: 403 });
  if (error.type === 'unauthorized') return new Response(null, { status: 401 });
  if (error.type === 'notFound' || error.type === 'validation') return new Response(null, { status: 404 });
  const t = await getTranslations();
  const state = toActionState({ ok: false, error }, t);
  return Response.json({ code: error.code, message: state.status === 'error' ? state.message : '' }, { status: 409, headers: { 'cache-control': 'private, no-store' } });
}

/** Eine Datei zum Speichern, nie im Zwischenspeicher. */
export function attachment(bytes: Uint8Array, filename: string, contentType: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
      'content-length': String(bytes.byteLength),
    },
  });
}
