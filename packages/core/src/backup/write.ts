import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import { lstat, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import tarStream from 'tar-stream';
import type { AppDeps } from '../app';
import type { AppEnv } from '../deps';
import { newId } from '../ids';
import { enabledManifests } from '../modules/service';
import { BACKUP_FORMAT, type BackupCounts, type BackupManifest } from './manifest';
import { FILE_STORE_TEMP_DIR } from '../files/store';
import { BACKUP_WORK_PREFIX } from './paths';

/** Wo die Datenbank im Archiv liegt — dasselbe Layout wie unter `dataPath`. */
export const DB_DIR_RELATIVE = ['core', 'db'] as const;
export const DB_RELATIVE = [...DB_DIR_RELATIVE, 'kompass.db'] as const;
const DB_ENTRY = ['data', ...DB_RELATIVE].join('/');
const DB_DIR = path.join(...DB_DIR_RELATIVE);

/** Was ein Backup aus der laufenden Installation braucht — ohne die ganzen Deps, damit B4 es auch vor dem Start bauen kann. */
export interface BackupSource {
  dataPath: string;
  env: AppEnv;
  appVersion: string;
  migrationCount: number;
  backupDatabase(destination: string): Promise<void>;
  /** Zählungen der eingeschalteten Module, Schlüssel `<modul>.<ding>`. */
  moduleCounts(): Record<string, number>;
}

export function backupSourceOf(deps: AppDeps): BackupSource {
  return {
    dataPath: deps.dataPath,
    env: deps.env,
    appVersion: deps.appVersion,
    migrationCount: deps.migrationCount,
    backupDatabase: (destination) => deps.backupDatabase(destination),
    moduleCounts: () => {
      const records: Record<string, number> = {};
      for (const manifest of enabledManifests(deps)) {
        for (const [thing, n] of Object.entries(manifest.backupCounts?.(deps) ?? {})) records[`${manifest.key}.${thing}`] = n;
      }
      return records;
    },
  };
}

/**
 * Ein konsistenter Schnitt der Datenbank über die SQLite-Backup-API, danach ohne Sitzungen und API-Tokens: Eine rohe
 * Kopie lieferte gültige Sitzungscookies und Token-Hashes mit aus. Gezählt wird auf der Kopie, also genau das, was ins
 * Archiv geht.
 */
export async function snapshotDatabase(source: BackupSource, dbCopyPath: string): Promise<{ counts: BackupCounts }> {
  await source.backupDatabase(dbCopyPath);
  const copy = new Database(dbCopyPath);
  try {
    copy.exec('delete from sessions; delete from api_tokens; vacuum;');
    // Die Kopie erbt den WAL-Modus; als einzelne Datei ins Archiv, ohne -wal/-shm daneben.
    copy.pragma('journal_mode = DELETE');
    const n = (table: string) => (copy.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
    const counts: BackupCounts = { users: n('users'), auditEntries: n('audit_log'), mediaAssets: n('media_assets'), records: source.moduleCounts() };
    return { counts };
  } finally {
    copy.close();
  }
}

interface PlannedFile {
  abs: string;
  path: string;
}

/**
 * Alles unter `dataPath`, außer: Punkt-Einträge der obersten Ebene (Rückfahrkarten eines Imports, Betriebsgeschiebe —
 * sonst trüge jedes Backup den Bestand des vorigen), `core/db` (die Datenbank kommt aus der Kopie), WAL-Reste und die
 * Temp-Verzeichnisse der Dateiablagen (werdende Dateien, `files/store.ts`).
 */
async function collectFiles(dataPath: string): Promise<PlannedFile[]> {
  const files: PlannedFile[] = [];
  const walk = async (rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(dataPath, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (rel === '' && entry.name.startsWith('.')) continue;
      const childRel = rel === '' ? entry.name : path.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (childRel === DB_DIR || entry.name === FILE_STORE_TEMP_DIR) continue;
        await walk(childRel);
      } else if (entry.isFile()) {
        if (/\.db-(wal|shm)$/.test(entry.name)) continue;
        files.push({ abs: path.join(dataPath, childRel), path: 'data/' + childRel.split(path.sep).join('/') });
      }
    }
  };
  await walk('');
  return files;
}

function hashingCounter(): Transform & { digest(): string; bytes(): number } {
  const hash = createHash('sha256');
  let bytes = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  return Object.assign(transform, { digest: () => hash.digest('hex'), bytes: () => bytes });
}

/** Die Teildatei liegt neben dem Ziel und trägt das Präfix der Arbeitsdateien — die Liste übersieht sie, das Aufräumen findet sie. */
function partPathFor(archivePath: string): string {
  return path.join(path.dirname(archivePath), `${BACKUP_WORK_PREFIX}${path.basename(archivePath)}.part`);
}

/**
 * Format 3 als Strom: `tar` ohne gzip direkt aus `dataPath` und der Datenbank-Kopie, ohne Zwischenkopie. Bilder und
 * PDFs werden durch gzip nicht kleiner, es kostete nur Rechenzeit im Hauptthread.
 */
export async function writeBackupArchive(
  source: BackupSource,
  opts: {
    dbCopyPath: string;
    counts: BackupCounts;
    archivePath: string;
    createdAt: string;
    signal?: AbortSignal;
    onProgress?: (doneBytes: number, totalBytes: number) => void;
  },
): Promise<{ manifest: BackupManifest; sizeBytes: number; sha256: string }> {
  opts.signal?.throwIfAborted();
  const partPath = partPathFor(opts.archivePath);
  const mtime = new Date(opts.createdAt);
  const pack = tarStream.pack();
  const counter = hashingCounter();
  const done = pipeline(pack, counter, createWriteStream(partPath), opts.signal ? { signal: opts.signal } : {});
  // Ein Fehler der Kette zeigt sich auch beim Schreiben der Einträge; abgeholt wird er unten.
  done.catch(() => undefined);

  const addFile = async (name: string, abs: string, size: number): Promise<void> => {
    const header = { name, size, mtime, mode: 0o644, type: 'file' as const };
    if (size === 0) {
      await new Promise<void>((resolve, reject) => pack.entry(header, Buffer.alloc(0), (error) => (error ? reject(error) : resolve())));
      return;
    }
    // Bis zur gemessenen Größe: Eine gewachsene Datei wird gekürzt, eine geschrumpfte lässt tar-stream mit
    // „size mismatch“ scheitern — der Lauf scheitert dann ehrlich, statt ein falsches Archiv zu schreiben.
    await pipeline(createReadStream(abs, { start: 0, end: size - 1 }), pack.entry(header));
  };

  try {
    const dbSize = (await lstat(opts.dbCopyPath)).size;
    const planned = await collectFiles(source.dataPath);
    const plannedSizes = await Promise.all(planned.map((f) => lstat(f.abs).then((s) => s.size, () => 0)));
    const total = dbSize + plannedSizes.reduce((a, b) => a + b, 0);
    const written: { path: string; size: number }[] = [];
    let doneBytes = 0;

    await addFile(DB_ENTRY, opts.dbCopyPath, dbSize);
    written.push({ path: DB_ENTRY, size: dbSize });
    doneBytes += dbSize;
    opts.onProgress?.(doneBytes, total);
    opts.signal?.throwIfAborted();

    for (const file of planned) {
      // Unmittelbar vor dem Schreiben messen: Was seit der Liste verschwand, fehlt auch im Manifest.
      const stat = await lstat(file.abs).catch(() => null);
      if (stat?.isFile()) {
        await addFile(file.path, file.abs, stat.size);
        written.push({ path: file.path, size: stat.size });
        doneBytes += stat.size;
      }
      opts.onProgress?.(doneBytes, total);
      opts.signal?.throwIfAborted();
    }

    // Das Manifest beschreibt, was wirklich im Archiv steht — deshalb steht es am Ende.
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      appVersion: source.appVersion,
      createdAt: opts.createdAt,
      environment: source.env,
      migrationCount: source.migrationCount,
      counts: opts.counts,
      files: written,
    };
    pack.entry({ name: 'manifest.json', mtime, mode: 0o644 }, Buffer.from(JSON.stringify(manifest, null, 2)));
    pack.finalize();
    await done;
    await rename(partPath, opts.archivePath);
    return { manifest, sizeBytes: counter.bytes(), sha256: counter.digest() };
  } catch (error) {
    pack.destroy();
    await done.catch(() => undefined);
    await rm(partPath, { force: true });
    throw error;
  }
}

/** Datenbank-Schnitt und Archiv in einem; die Kopie liegt als Arbeitsdatei in `workDir` und verschwindet danach. */
export async function createBackupArchive(
  source: BackupSource,
  opts: {
    archivePath: string;
    workDir: string;
    createdAt: string;
    signal?: AbortSignal;
    onProgress?: (doneBytes: number, totalBytes: number) => void;
  },
): Promise<{ manifest: BackupManifest; sizeBytes: number; sha256: string }> {
  const dbCopyPath = path.join(opts.workDir, `${BACKUP_WORK_PREFIX}${newId()}.db`);
  try {
    const { counts } = await snapshotDatabase(source, dbCopyPath);
    return await writeBackupArchive(source, { ...opts, dbCopyPath, counts });
  } finally {
    await Promise.all(['', '-wal', '-shm', '-journal'].map((suffix) => rm(dbCopyPath + suffix, { force: true })));
  }
}
