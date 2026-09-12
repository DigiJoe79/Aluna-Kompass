import { requirePermission } from '@kompass/core';
import { currentSiteJob } from '@kompass/module-site';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

/**
 * Was gerade gebaut oder übertragen wird. Bewusst ein Route Handler und keine
 * Server Action: Next führt die Actions einer Seite nacheinander aus, eine
 * Abfrage während des Baus käme also erst nach dem Bau an die Reihe.
 */
export async function GET(): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  if (requirePermission(session.ctx, 'site.publish')) return new Response(null, { status: 403 });
  return Response.json(currentSiteJob(siteEnv()), { headers: { 'cache-control': 'no-store' } });
}
