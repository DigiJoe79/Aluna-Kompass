import { isModuleEnabled } from '@kompass/core';
import { listOutbox } from '@kompass/module-dms';
import { getDeps } from '@/lib/deps';
import { readAllPages } from '@/lib/read-all-pages';
import { optionalSession } from '@/lib/request-context';
import { statusFor } from '../export/status';

export const dynamic = 'force-dynamic';

/**
 * Ob eine Sendung eines Laufs noch unterwegs ist (wartet, wird gesendet) — für den Versand-Schritt der Läufe
 * (Mitglieder und Serienlauf), der sich erneuert, sobald alle draußen oder abgelehnt sind. Wie `/dms/[id]/mail-status`
 * ein Route Handler und keine Server Action: Actions laufen seriell, eine Abfrage im Takt hielte jede Handlung auf.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'dms')) return new Response(null, { status: 404 });
  const runRef = new URL(request.url).searchParams.get('runRef');
  if (!runRef) return new Response(null, { status: 400 });
  const result = await readAllPages((page) => listOutbox(deps, session.ctx, { runRef, ...page }), (v) => v.items);
  if (!result.ok) return new Response(null, { status: statusFor(result.error) });
  const pending = result.value.some((item) => item.status === 'queued' || item.status === 'sending');
  return Response.json({ pending }, { headers: { 'cache-control': 'no-store' } });
}
