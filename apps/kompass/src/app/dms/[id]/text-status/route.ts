import { isModuleEnabled } from '@kompass/core';
import { getDocumentTextStatus } from '@kompass/module-dms';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { statusFor } from '../../export/status';

export const dynamic = 'force-dynamic';

/**
 * Der Stand der Texterkennung eines Dokuments. Bewusst ein Route Handler und
 * keine Server Action und kein `router.refresh()` im Takt: Next führt die
 * Actions einer Seite nacheinander aus, jede Abfrage davor hielte Verschieben
 * und Rückgängig auf. Wer das Dokument nicht lesen darf, bekommt dasselbe wie
 * die Seite: 403 beziehungsweise 404.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'dms')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const result = await getDocumentTextStatus(deps, session.ctx, id);
  if (!result.ok) return new Response(null, { status: statusFor(result.error) });
  return Response.json(result.value, { headers: { 'cache-control': 'no-store' } });
}
