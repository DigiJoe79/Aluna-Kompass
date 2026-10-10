import { siteJobOverview, sitePendingChanges, SITE_JOB_KINDS } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { failureStatus, PENDING_MENU_ITEMS, pendingVariableNames, viewSummary, type OverviewView, type PendingView } from '@/lib/site-job-view';

/**
 * Was gerade gebaut oder übertragen wird und das letzte Ergebnis jeder Art, in
 * Kurzform. Bewusst ein Route Handler und keine Server Action: Next führt die
 * Actions einer Seite nacheinander aus, eine Abfrage während des Baus käme also
 * erst nach dem Bau an die Reihe.
 *
 * Die verstrichene Zeit rechnet der Dienst selbst aus — mit derselben Uhr, die
 * auch `startedAt` gesetzt hat. Ginge stattdessen die Uhr im Browser des
 * Aufrufers ein, zeigte eine falsch gehende Client-Uhr einen falschen Stand.
 *
 * Dazu, was seit dem letzten Publish der Produktion öffentlich anders ist (Plan C) — gecacht im Dienst, eine Abfrage
 * je Aufruf, solange nichts geschrieben wurde.
 */
export async function GET(): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const read = siteJobOverview(getDeps(), session.ctx, siteEnv());
  if (!read.ok) return new Response(null, { status: failureStatus(read.error) });
  const t = await getTranslations();
  const last = Object.fromEntries(SITE_JOB_KINDS.map((kind) => [kind, viewSummary(read.value.last[kind], t)])) as OverviewView['last'];
  const pendingRead = await sitePendingChanges(getDeps(), session.ctx, {});
  const pending: PendingView | null = pendingRead.ok
    ? {
        since: pendingRead.value.since,
        count: pendingRead.value.count,
        items: pendingRead.value.items.slice(0, PENDING_MENU_ITEMS),
        hrefs: [...new Set(pendingRead.value.items.flatMap((i) => (i.recordHref ? [i.recordHref] : [])))],
        variables: pendingVariableNames(pendingRead.value.items),
      }
    : null;
  return Response.json({ running: read.value.running, last, pending } satisfies OverviewView, { headers: { 'cache-control': 'no-store' } });
}
