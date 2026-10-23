import { isSetupRequired, receiveSetupBackupUpload } from '@kompass/core';
import { uploadFailure } from '@/lib/backup-download';
import { getDeps } from '@/lib/deps';
import { maintenanceRefusal } from '@/lib/maintenance-refusal';

export const dynamic = 'force-dynamic';

/**
 * Ersteinrichtung aus einem Backup: dieselbe Annahme wie unter System › Backup, ohne Anmeldung und nur solange die
 * Installation leer ist. Die Datei landet geprüft als „Hochgeladen“ im Backup-Verzeichnis; `handle` ist ihr Name.
 */
export async function POST(request: Request): Promise<Response> {
  const refused = maintenanceRefusal();
  if (refused) return refused;
  const deps = getDeps();
  // Nur zur Bedienbarkeit — maßgeblich prüft der Kern bei Annahme und Einspielen.
  if (!isSetupRequired(deps)) return new Response(null, { status: 409 });
  if (!request.body) return new Response(null, { status: 400 });
  const result = await receiveSetupBackupUpload(deps, { body: request.body, contentLength: Number(request.headers.get('content-length')) || null });
  if (!result.ok) return uploadFailure(result.error);
  return Response.json({ handle: result.value.name, manifest: result.value.manifest });
}
