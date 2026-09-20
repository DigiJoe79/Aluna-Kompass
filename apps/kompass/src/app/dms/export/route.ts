import { exportBundle } from '@kompass/module-dms';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { statusFor } from './status';

export const dynamic = 'force-dynamic';

/**
 * Das Bündel liegt als Datei im Temp-Verzeichnis und wird gestreamt — anders als
 * das Backup, das sein Archiv in den Speicher liest. Ein Jahrgang der Akte hat
 * Hunderte Megabyte. Gelöscht wird, wenn der Strom endet, **und** wenn er
 * abbricht: Wer den Download abbricht, soll keine Kopie der Akte in /tmp lassen.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object') return new Response(null, { status: 400 });

  // Nur die drei Auswahlfelder: `linkedAccess` und `workDir` kommen nie vom Browser.
  const { folder, year, documentIds } = body as Record<string, unknown>;
  const result = await exportBundle(getDeps(), session.ctx, { folder, year, documentIds, workDir: tmpdir() } as never);
  if (!result.ok) return Response.json(result.error, { status: statusFor(result.error) });

  const { archivePath, filename } = result.value;
  const { size } = await stat(archivePath);
  const file = createReadStream(archivePath);
  const cleanUp = () => void rm(archivePath, { force: true });
  file.once('close', cleanUp);
  file.once('error', cleanUp);
  return new Response(Readable.toWeb(file) as ReadableStream, {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${filename}"`, 'content-length': String(size), 'cache-control': 'private, no-store' },
  });
}
