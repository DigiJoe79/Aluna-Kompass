import { lastSiteJob } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { toActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

/**
 * Stand und letztes Ergebnis eines Hintergrundlaufs (`preview`, `publish`,
 * `deployCheck`), den eine Karte der Publizieren-Seite gestartet hat. Ein
 * Route Handler aus demselben Grund wie /site/job: Die Karte fragt jede
 * Sekunde nach, und Server Actions einer Seite laufen nacheinander.
 *
 * `running` nennt nur einen laufenden Lauf derselben Art — was sonst läuft,
 * zeigt die Laufanzeige. Ein Fehler kommt übersetzt, wie ihn eine Action meldete.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { kind } = await params;
  const read = lastSiteJob(getDeps(), session.ctx, siteEnv(), { kind });
  if (!read.ok) return new Response(null, { status: read.error.type === 'forbidden' ? 403 : read.error.type === 'validation' ? 404 : 500 });
  const { running, last } = read.value;
  const t = await getTranslations();
  const body = {
    running: running?.name === kind ? { runId: running.runId, startedAt: running.startedAt } : null,
    last: last
      ? {
          runId: last.runId,
          startedAt: last.startedAt,
          finishedAt: last.finishedAt,
          ...(last.result !== undefined ? { result: last.result } : {}),
          ...(last.error ? { error: (toActionState({ ok: false, error: last.error }, t) as { message: string }).message } : {}),
        }
      : null,
  };
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
