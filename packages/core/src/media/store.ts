import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface MediaStore {
  /** Dateisystem-Wurzel oder null (In-Memory). */
  rootDir: string | null;
  write(filename: string, bytes: Uint8Array): Promise<void>;
  read(filename: string): Promise<Uint8Array>;
  exists(filename: string): Promise<boolean>;
  pathFor(filename: string): string | null;
  /** Idempotent: fehlt die Datei, kein Fehler. */
  delete(filename: string): Promise<void>;
}

const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]{0,180}$/;

export function assertSafeFilename(filename: string): void {
  if (!SAFE_FILENAME.test(filename) || filename.includes('..')) throw new Error(`unsafe media filename: ${filename}`);
}

export function createFileMediaStore(rootDir: string): MediaStore {
  const resolve = (filename: string) => {
    assertSafeFilename(filename);
    return path.join(rootDir, filename);
  };
  return {
    rootDir,
    async write(filename, bytes) {
      await mkdir(rootDir, { recursive: true });
      await writeFile(resolve(filename), bytes, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e; // identischer Inhalt (Hash im Namen) ⇒ bereits vorhanden
      });
    },
    read: (filename) => readFile(resolve(filename)),
    exists: (filename) => stat(resolve(filename)).then(() => true, () => false),
    pathFor: (filename) => resolve(filename),
    async delete(filename) {
      await unlink(resolve(filename)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    },
  };
}

export function createMemoryMediaStore(): MediaStore {
  const files = new Map<string, Uint8Array>();
  return {
    rootDir: null,
    async write(filename, bytes) {
      assertSafeFilename(filename);
      if (!files.has(filename)) files.set(filename, new Uint8Array(bytes));
    },
    async read(filename) {
      const bytes = files.get(filename);
      if (!bytes) throw new Error(`media not found: ${filename}`);
      return bytes;
    },
    exists: async (filename) => files.has(filename),
    pathFor: () => null,
    async delete(filename) {
      assertSafeFilename(filename);
      files.delete(filename);
    },
  };
}