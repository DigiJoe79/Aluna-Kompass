import { openBackupDownload } from '@kompass/core';
import { backupFailureStatus, backupFileResponse } from '@/lib/backup-download';
import { getDeps } from '@/lib/deps';
import { parseRange } from '@/lib/http-range';
import { optionalSession } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * Ein Backup als normaler Download: ein Link, den der Browser selbst holt — mit Fortschritt, fortsetzbar (`Range`),
 * ohne die Datei in den Speicher zu lesen. Recht `backup.export`; protokolliert wird der Anfang.
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { name } = await params;
  const deps = getDeps();
  // Die Größe kennt erst der Dienst; den Bereich liest `parseRange` danach gegen sie. Für das Protokoll zählt nur, wo
  // der Download beginnt — ein fortgesetzter ist derselbe (ein Bereich vom Ende her beginnt nicht am Anfang).
  const header = request.headers.get('range')?.trim() ?? null;
  const from = /^bytes=(\d+)-\d*$/.exec(header ?? '');
  const rangeStart = from ? Number(from[1]) : /^bytes=-\d+$/.test(header ?? '') ? 1 : 0;
  const opened = await openBackupDownload(deps, session.ctx, { name, rangeStart });
  if (!opened.ok) return new Response(null, { status: backupFailureStatus(opened.error) });
  return backupFileResponse(opened.value, parseRange(header, opened.value.sizeBytes));
}
