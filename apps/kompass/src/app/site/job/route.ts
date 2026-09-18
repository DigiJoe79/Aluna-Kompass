import { requirePermission } from '@kompass/core';
import { currentSiteJob, siteJobElapsedMs } from '@kompass/module-site';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

/**
 * Was gerade gebaut oder übertragen wird. Bewusst ein Route Handler und keine
 * Server Action: Next führt die Actions einer Seite nacheinander aus, eine
 * Abfrage während des Baus käme also erst nach dem Bau an die Reihe.
 *
 * Die verstrichene Zeit rechnet dieser Handler selbst aus — mit derselben Uhr,
 * die auch `startedAt` gesetzt hat. Ginge stattdessen die Uhr im Browser des
 * Aufrufers ein, zeigte eine falsch gehende Client-Uhr ab dem ersten Tick
 * einen falschen Stand, egal wie kurz der Lauf wirklich schon geht.
 */
export async function GET(): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  if (requirePermission(session.ctx, 'site.publish')) return new Response(null, { status: 403 });
  const job = currentSiteJob(siteEnv());
  const body = job ? { name: job.name, elapsedMs: siteJobElapsedMs(job, getDeps().clock) } : null;
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
