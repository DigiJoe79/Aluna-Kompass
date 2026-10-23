import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, localizedConflict, ok, type Failure, type Result } from '../result';
import { isSetupRequired } from '../setup/service';
import { BACKUP_MAX_UNPACKED_BYTES } from './archive';
import { pruneBackupRing } from './create';
import { BACKUP_WORK_PREFIX } from './paths';
import { backupFileName, backupFiles, uniqueBackupName, writeSidecar, type BackupSidecar } from './sidecar';
import { verifyBackupArchive } from './verify';

/*
 * Eine Backup-Datei hochladen (Umzug, Ersteinrichtung): in einem Durchgang als Strom, ohne die 512-MB-Grenze der
 * Server Actions. Sie landet als Art „Hochgeladen“ im Verzeichnis und wird von dort eingespielt — ein Weg statt zwei.
 * Bis zur bestandenen Prüfung liegt sie als Arbeitsdatei `.work-*`; was scheitert, hinterlässt nichts.
 */

export interface BackupUploadInput {
  body: ReadableStream<Uint8Array>;
  /** Aus dem Kopf `Content-Length`, falls angegeben: ein zu großes Backup wird abgelehnt, bevor ein Byte gelesen ist. */
  contentLength: number | null;
}

class UploadTooLargeError extends Error {}

const tooLarge = (): Failure => localizedConflict('backupTooLarge', 'backup.errors.backupTooLarge', { gb: Math.round(BACKUP_MAX_UNPACKED_BYTES / 1024 ** 3) });
const pathMissing = (): Failure => localizedConflict('backupPathMissing', 'backup.errors.backupPathMissing');

async function storeUpload(deps: AppDeps, ctx: CallContext, input: BackupUploadInput, setup: boolean): Promise<Result<BackupSidecar>> {
  if (!deps.backupPath) return pathMissing();
  const bp = deps.backupPath;
  if (input.contentLength !== null && input.contentLength > BACKUP_MAX_UNPACKED_BYTES) return tooLarge();
  const temp = path.join(bp, `${BACKUP_WORK_PREFIX}${newId()}.upload`);
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > BACKUP_MAX_UNPACKED_BYTES) return done(new UploadTooLargeError());
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(input.body as Parameters<typeof Readable.fromWeb>[0]), limiter, createWriteStream(temp));
  } catch (error) {
    await rm(temp, { force: true });
    if (error instanceof UploadTooLargeError) return tooLarge();
    throw error;
  }

  let stored = false;
  try {
    const outcome = await verifyBackupArchive(temp, { workDir: bp });
    if (!outcome.ok) return invalid([{ path: 'archive', message: outcome.reason }]);
    // Ohne Nutzer bliebe eine neue Installation unbenutzbar und zugleich dauerhaft offen.
    if (setup && outcome.manifest.counts.users === 0) return invalid([{ path: 'archive', message: 'backupWithoutUsers' }]);
    const now = isoNow(deps.clock);
    const name = uniqueBackupName(bp, backupFileName(deps.env, now, 'upload'));
    await rename(temp, backupFiles(bp, name)!.archive);
    stored = true;
    const sidecar: BackupSidecar = {
      version: 1,
      name,
      kind: 'upload',
      createdAt: now,
      sizeBytes: outcome.sizeBytes,
      sha256: outcome.sha256,
      manifest: outcome.manifest,
      verification: { status: 'passed', at: now },
      pinned: false,
      pinnedLabel: null,
    };
    writeSidecar(bp, sidecar);
    deps.db.transaction((tx) => recordAudit(tx, deps, ctx, { action: 'backup.upload', entityType: 'backup', entityId: name, params: { sizeBytes: outcome.sizeBytes } }));
    await pruneBackupRing(deps, ctx);
    return ok(sidecar);
  } finally {
    if (!stored) await rm(temp, { force: true });
  }
}

/** Nimmt eine Backup-Datei als Strom an (Route Handler). Recht `backup.import`. */
export async function receiveBackupUpload(deps: AppDeps, ctx: CallContext, input: BackupUploadInput): Promise<Result<BackupSidecar>> {
  const denied = requirePermission(ctx, 'backup.import');
  if (denied) return denied;
  return storeUpload(deps, ctx, input, false);
}

/** Dasselbe ohne Anmeldung, nur solange die Einrichtung aussteht (`/setup/import`). */
export async function receiveSetupBackupUpload(deps: AppDeps, input: BackupUploadInput): Promise<Result<BackupSidecar>> {
  if (!isSetupRequired(deps)) return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
  return storeUpload(deps, systemContext(), input, true);
}
