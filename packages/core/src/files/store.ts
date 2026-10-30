import { rmSync } from 'node:fs';
import { link, mkdir, open, readFile, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { newId } from '../ids';

/**
 * Ein Verzeichnis, in dem ein Bereich seine Dateien ablegt. Die Mediathek war
 * der erste; jedes Modul mit `files: true` im Manifest bekommt einen eigenen
 * unter `<dataPath>/<modulschlüssel>`.
 */
export interface FileStore {
  /** Dateisystem-Wurzel oder null (In-Memory). */
  rootDir: string | null;
  write(filename: string, bytes: Uint8Array): Promise<void>;
  read(filename: string): Promise<Uint8Array>;
  exists(filename: string): Promise<boolean>;
  pathFor(filename: string): string | null;
  /** Idempotent: fehlt die Datei, kein Fehler. */
  delete(filename: string): Promise<void>;
  /** Räumt Reste abgebrochener Schreibvorgänge weg. Nur beim Start, nie während des Betriebs. */
  sweepTemp(): Promise<void>;
}

/**
 * Unterverzeichnis jeder Ablage für werdende Dateien. Der Punkt hält es aus
 * `SAFE_FILENAME` heraus (keine Datei kann so heißen); das Backup lässt es aus
 * (`backup/write.ts`).
 */
export const FILE_STORE_TEMP_DIR = '.tmp';

/** Synchron, weil `createDeps` synchron startet. */
export function sweepFileStoreTemp(rootDir: string): void {
  rmSync(path.join(rootDir, FILE_STORE_TEMP_DIR), { recursive: true, force: true });
}

/** Ohne harte Links gäbe es kein atomares „anlegen, wenn nicht vorhanden“ — lieber laut scheitern als halb schreiben. */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);

const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]{0,180}$/;

export function assertSafeFilename(filename: string): void {
  if (!SAFE_FILENAME.test(filename) || filename.includes('..')) throw new Error(`unsafe filename: ${filename}`);
}

export function createFileStore(rootDir: string): FileStore {
  const resolve = (filename: string) => {
    assertSafeFilename(filename);
    return path.join(rootDir, filename);
  };
  return {
    rootDir,
    /**
     * Atomar und ohne zu überschreiben: Die Bytes landen erst in `.tmp/<ULID>`,
     * werden mit `fsync` auf die Platte gebracht und dann per hartem Link unter
     * ihren Namen gestellt. `link` legt nur an, wenn der Name frei ist — `EEXIST`
     * heißt „schon vorhanden“ (der Hash steht im Namen, festgeschriebene
     * Dateien bleiben unverändert). Wer ersetzen will, löscht vorher selbst.
     * Ein Abbruch hinterlässt höchstens eine Temp-Datei, nie eine halbe unter
     * ihrem Namen; `exists()` sieht so nie etwas Halbes.
     */
    async write(filename, bytes) {
      const target = resolve(filename);
      const tempDir = path.join(rootDir, FILE_STORE_TEMP_DIR);
      await mkdir(tempDir, { recursive: true });
      const temp = path.join(tempDir, newId());
      try {
        const handle = await open(temp, 'wx');
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await link(temp, target).catch((e: NodeJS.ErrnoException) => {
          if (e.code === 'EEXIST') return;
          if (e.code && NO_HARD_LINKS.has(e.code)) {
            throw new Error(`Dateiablage unterstützt keine harten Links (${e.code}): ${rootDir}`, { cause: e });
          }
          throw e;
        });
      } finally {
        await unlink(temp).catch(() => undefined);
      }
    },
    read: (filename) => readFile(resolve(filename)),
    exists: (filename) => stat(resolve(filename)).then(() => true, () => false),
    pathFor: (filename) => resolve(filename),
    async delete(filename) {
      await unlink(resolve(filename)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    },
    async sweepTemp() {
      await rm(path.join(rootDir, FILE_STORE_TEMP_DIR), { recursive: true, force: true });
    },
  };
}

export function createMemoryFileStore(): FileStore {
  const files = new Map<string, Uint8Array>();
  return {
    rootDir: null,
    async write(filename, bytes) {
      assertSafeFilename(filename);
      if (!files.has(filename)) files.set(filename, new Uint8Array(bytes));
    },
    async read(filename) {
      const bytes = files.get(filename);
      if (!bytes) throw new Error(`file not found: ${filename}`);
      return bytes;
    },
    exists: async (filename) => files.has(filename),
    pathFor: () => null,
    async delete(filename) {
      assertSafeFilename(filename);
      files.delete(filename);
    },
    async sweepTemp() {},
  };
}