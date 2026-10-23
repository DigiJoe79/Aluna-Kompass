import { receiveBackupUpload } from '@kompass/core';
import { uploadFailure } from '@/lib/backup-download';
import { getDeps } from '@/lib/deps';
import { maintenanceRefusal } from '@/lib/maintenance-refusal';
import { optionalSession } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * Eine Backup-Datei hochladen: der Körper als Strom in einem Durchgang, ohne die Grenze der Server Actions. Die Datei
 * landet geprüft als „Hochgeladen“ im Backup-Verzeichnis und wird von dort eingespielt.
 */
export async function POST(request: Request): Promise<Response> {
  const refused = maintenanceRefusal();
  if (refused) return refused;
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  if (!request.body) return new Response(null, { status: 400 });
  const result = await receiveBackupUpload(getDeps(), session.ctx, { body: request.body, contentLength: Number(request.headers.get('content-length')) || null });
  if (result.ok) return Response.json(result.value, { headers: { 'cache-control': 'no-store' } });
  return uploadFailure(result.error);
}
