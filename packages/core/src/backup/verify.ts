import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import tarStream from 'tar-stream';
import { newId } from '../ids';
import { backupManifestSchema, type BackupManifest } from './manifest';
import { BACKUP_WORK_PREFIX } from './paths';
import type { BackupVerifyFailure } from './sidecar';

export type VerifyOutcome =
  | { ok: true; manifest: BackupManifest; sha256: string; sizeBytes: number }
  | { ok: false; reason: BackupVerifyFailure; manifest: BackupManifest | null; sha256: string | null };

const DB_ENTRY = 'data/core/db/kompass.db';
const MANIFEST_ENTRY = 'manifest.json';
/** Ein Manifest dieser Größe ist kein Manifest mehr; nicht weiter puffern. */
const MANIFEST_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Liest das Archiv in einem Durchgang ganz: Prüfsumme über alle Bytes, je Eintrag Name und tatsächlich gelesene Größe,
 * die Datenbank als Arbeitsdatei in `workDir`, das Manifest im Speicher. Danach in fester Reihenfolge: Manifest und
 * Format, jede Datei der Liste vorhanden und gleich groß, `pragma integrity_check`, erwartete Prüfsumme.
 * Ein Backup, das hier besteht, lässt sich einspielen — das ist der Zweck.
 */
export async function verifyBackupArchive(
  archivePath: string,
  opts: { workDir: string; expectedSha256?: string | null; signal?: AbortSignal; onProgress?: (doneBytes: number, totalBytes: number) => void },
): Promise<VerifyOutcome> {
  const fail = (reason: BackupVerifyFailure, manifest: BackupManifest | null = null, sha256: string | null = null): VerifyOutcome => ({
    ok: false,
    reason,
    manifest,
    sha256,
  });

  opts.signal?.throwIfAborted();
  const totalBytes = (await stat(archivePath)).size;
  // Format 2 war `.tar.gz`; gzip beginnt mit 1f 8b. Sofort ablehnen statt es als kaputtes tar zu lesen.
  const handle = await open(archivePath, 'r');
  const head = Buffer.alloc(2);
  try {
    await handle.read(head, 0, 2, 0);
  } finally {
    await handle.close();
  }
  if (head[0] === 0x1f && head[1] === 0x8b) return fail('backupFormatUnsupported');

  const dbWork = path.join(opts.workDir, `${BACKUP_WORK_PREFIX}${newId()}-verify.db`);
  try {
    const hash = createHash('sha256');
    let doneBytes = 0;
    const hasher = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        hash.update(chunk);
        doneBytes += chunk.length;
        opts.onProgress?.(doneBytes, totalBytes);
        callback(null, chunk);
      },
    });
    const sizes = new Map<string, number>();
    let manifestRaw: Buffer | null = null;
    let manifestTooLarge = false;
    let sawDb = false;
    let entries = 0;

    const extract = tarStream.extract();
    extract.on('entry', (header, stream, next) => {
      entries++;
      const name = header.name.replace(/^\.\//, '');
      let size = 0;
      const chunks: Buffer[] = [];
      const counted = new Transform({
        transform(chunk: Buffer, _enc, callback) {
          size += chunk.length;
          if (name === MANIFEST_ENTRY && !manifestTooLarge) {
            if (size > MANIFEST_MAX_BYTES) manifestTooLarge = true;
            else chunks.push(chunk);
          }
          callback(null, name === DB_ENTRY ? chunk : undefined);
        },
      });
      const sink = name === DB_ENTRY ? createWriteStream(dbWork) : null;
      const finished = sink ? pipeline(stream, counted, sink) : pipeline(stream, counted).then(() => undefined);
      if (!sink) counted.resume();
      finished.then(
        () => {
          sizes.set(name, size);
          if (name === DB_ENTRY) sawDb = true;
          if (name === MANIFEST_ENTRY && !manifestTooLarge) manifestRaw = Buffer.concat(chunks);
          next();
        },
        (error: unknown) => next(error as Error),
      );
    });

    try {
      await pipeline(createReadStream(archivePath), hasher, extract, opts.signal ? { signal: opts.signal } : {});
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      // Scheitert schon der erste Kopf, ist es kein tar; danach ist es ein beschädigtes (etwa abgeschnittenes) Archiv.
      return fail(entries === 0 ? 'backupFormatUnsupported' : 'backupUnreadable');
    }
    const sha256 = hash.digest('hex');

    if (manifestTooLarge || manifestRaw === null) return fail('backupFormatUnsupported', null, sha256);
    let json: unknown;
    try {
      json = JSON.parse((manifestRaw as Buffer).toString('utf8'));
    } catch {
      return fail('backupFormatUnsupported', null, sha256);
    }
    const parsed = backupManifestSchema.safeParse(json);
    if (!parsed.success) return fail('backupFormatUnsupported', null, sha256);
    const manifest = parsed.data;

    for (const file of manifest.files) if (!sizes.has(file.path)) return fail('backupFileMissing', manifest, sha256);
    for (const file of manifest.files) if (sizes.get(file.path) !== file.size) return fail('backupFileSizeMismatch', manifest, sha256);

    if (!sawDb) return fail('backupCorrupt', manifest, sha256);
    let integrity: string;
    try {
      const probe = new Database(dbWork, { readonly: true, fileMustExist: true });
      try {
        integrity = (probe.prepare('pragma integrity_check').get() as { integrity_check: string }).integrity_check;
      } finally {
        probe.close();
      }
    } catch {
      return fail('backupCorrupt', manifest, sha256);
    }
    if (integrity !== 'ok') return fail('backupCorrupt', manifest, sha256);

    if (opts.expectedSha256 && opts.expectedSha256 !== sha256) return fail('backupChecksumMismatch', manifest, sha256);
    return { ok: true, manifest, sha256, sizeBytes: doneBytes };
  } finally {
    await Promise.all(['', '-wal', '-shm', '-journal'].map((suffix) => rm(dbWork + suffix, { force: true })));
  }
}
