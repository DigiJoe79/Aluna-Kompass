import { isModuleEnabled } from '@kompass/core';
import { listOutbox } from '@kompass/module-dms';
import { getDeps } from '@/lib/deps';
import { readAllPages } from '@/lib/read-all-pages';
import { optionalSession } from '@/lib/request-context';
import { statusFor } from '../../export/status';

export const dynamic = 'force-dynamic';

/**
 * Ob eine Sendung dieses Dokuments noch unterwegs ist (wartet, wird gesendet) — für die Karte „Versand“, die sich
 * erneuert, sobald die Mail draußen oder abgelehnt ist (Handoff 2b E2). Ein Route Handler, keine Server Action: Next
 * führt die Actions einer Seite nacheinander aus, eine Abfrage im Takt hielte jede Handlung auf.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'dms')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const result = await readAllPages((page) => listOutbox(deps, session.ctx, { documentId: id, ...page }), (v) => v.items);
  if (!result.ok) return new Response(null, { status: statusFor(result.error) });
  const pending = result.value.some((item) => item.status === 'queued' || item.status === 'sending');
  return Response.json({ pending }, { headers: { 'cache-control': 'no-store' } });
}
