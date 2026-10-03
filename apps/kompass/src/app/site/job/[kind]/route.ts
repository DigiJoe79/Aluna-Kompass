import { siteJobResult } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { failureStatus, viewSummary, type DetailView } from '@/lib/site-job-view';

/**
 * Das letzte Ergebnis einer Art (`preview`, `publish`, `deployCheck`) mit
 * Listen und Protokollende; `?paths=all` und `?log=full` geben alles. Ein Route
 * Handler aus demselben Grund wie /site/job: Server Actions einer Seite laufen
 * nacheinander. Ein Fehler kommt übersetzt, wie ihn eine Action meldete.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { kind } = await params;
  const query = new URL(request.url).searchParams;
  const read = siteJobResult(getDeps(), session.ctx, siteEnv(), {
    kind,
    ...(query.get('paths') === 'all' ? { paths: 'all' as const } : {}),
    ...(query.get('log') === 'full' ? { log: 'full' as const } : {}),
  });
  if (!read.ok) return new Response(null, { status: failureStatus(read.error) });
  const t = await getTranslations();
  const body: { running: unknown; last: DetailView | null } = { running: read.value.running, last: viewSummary(read.value.last, t) };
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
