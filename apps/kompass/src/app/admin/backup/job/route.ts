import { backupJobSlot, backupJobStatus, isMaintenanceActive, runningJob } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { backupFailureStatus } from '@/lib/backup-download';
import { backupJobView } from '@/lib/backup-job-view';
import { getDeps, runtimeEnv } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * Was gerade läuft und das letzte Ergebnis jeder Art (Erstellen, Prüfen, Einspielen). Bewusst ein Route Handler und
 * keine Server Action: Next führt die Actions einer Seite nacheinander aus, eine Abfrage während eines Laufs käme also
 * erst nach dem Lauf an die Reihe.
 *
 * Während eines Einspielens gibt es weder Sitzung noch Datenbank: Dann antwortet die Abfrage nur dem, der die Kennung
 * des laufenden Laufs kennt (`?runId=`), aus dem Speicher; alles andere bekommt 503 wie im Proxy.
 */
export async function GET(request?: Request): Promise<Response> {
  const bp = runtimeEnv().backupPath;
  if (isMaintenanceActive(bp)) {
    const runId = request ? new URL(request.url).searchParams.get('runId') : null;
    const running = runningJob(backupJobSlot(bp));
    if (!runId || running?.runId !== runId) return Response.json({ error: 'maintenance' }, { status: 503, headers: { 'retry-after': '30' } });
    return Response.json({ maintenance: true, running }, { headers: { 'cache-control': 'no-store' } });
  }
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  const read = await backupJobStatus(deps, session.ctx, {});
  if (!read.ok) return new Response(null, { status: backupFailureStatus(read.error) });
  // Die Sicht nennt Person und verstrichene Zeit und kürzt Ergebnisse auf den Namen (kein Manifest, keine Dateiliste).
  return Response.json(backupJobView(deps, read.value, await getTranslations(), deps.clock.now()), { headers: { 'cache-control': 'no-store' } });
}
