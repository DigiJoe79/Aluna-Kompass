import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inspectBackup, isSetupRequired, newId } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { clearUploads, MAX_UPLOAD_BYTES, resolveUpload } from '@/lib/setup-uploads';

export const dynamic = 'force-dynamic';

class UploadTooLargeError extends Error {}

export async function POST(request: Request): Promise<Response> {
  const deps = getDeps();
  // Nur zur Bedienbarkeit — massgeblich prueft der Kern beim Einspielen.
  if (!isSetupRequired(deps)) return new Response(null, { status: 409 });
  if (!request.body) return new Response(null, { status: 400 });

  // Vor jeder Annahme leeren: so belegt immer nur ein Archiv Platz.
  await clearUploads(deps.databasePath);
  const handle = newId();
  const file = resolveUpload(deps.databasePath, handle);
  if (!file) return new Response(null, { status: 500 });

  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        done(new UploadTooLargeError());
        return;
      }
      done(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
      limiter,
      createWriteStream(file),
    );
  } catch (error) {
    await rm(file, { force: true });
    if (error instanceof UploadTooLargeError) return new Response(null, { status: 413 });
    throw error;
  }

  const manifest = await inspectBackup({ archivePath: file, workDir: tmpdir() });
  if (!manifest.ok) {
    await rm(file, { force: true });
    return Response.json({ error: 'backupFormatUnsupported' }, { status: 422 });
  }
  return Response.json({ handle, manifest: manifest.value });
}
