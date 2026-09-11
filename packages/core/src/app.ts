import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { systemClock, type Clock } from './clock';
import { coreModule } from './core-module';
import { CORE_MODULE_KEY } from './modules/service';
import { openDatabase, runMigrations } from './db/client';
import type { AppEnv, Deps } from './deps';
import { noopDocumentEngine, type DocumentEngine } from './documents/engine';
import { createFileStore, type FileStore } from './files/store';
import type { DocumentTemplate, ModuleManifest } from './modules/manifest';
import { createRegistry } from './modules/registry';
import { readLocales } from './i18n/locales';
import { noopTextExtraction, type TextExtraction } from './text/extraction';

export interface CreateDepsOptions {
  /**
   * Die Wurzel für alles, was gesichert wird. Darunter liegt je Modul ein
   * Verzeichnis mit seinem Schlüssel; der Kern ist eines davon und hält
   * `core/db` und `core/media`. Geheimnisse gehören ausdrücklich **nicht**
   * hierher — sie werden über eigene Pfade eingehängt (`/secret`), damit
   * das Backup sie nicht einsammeln kann.
   */
  dataPath: string;
  env: AppEnv;
  modules?: ModuleManifest[];
  coreTemplates?: DocumentTemplate[];
  /** Ohne Angabe kann nicht gerendert werden (Skripte, migrationsnahe Tests). */
  documents?: DocumentEngine;
  /** Ohne Angabe ist Texterkennung nicht eingerichtet (Skripte, Tests ohne Modul). */
  textExtraction?: TextExtraction;
  clock?: Clock;
}

export type AppDeps = Deps & {
  /** Wurzel aller gesicherten Verzeichnisse; das Backup bildet sie ab. */
  dataPath: string;
  databasePath: string;
  migrationCount: number;
  backupDatabase(destination: string): Promise<void>;
  reopen(): void;
  close(): void;
};

/** `<dataPath>/core/db/kompass.db` — die Datenbank ist der Speicher des Kernmoduls. */
export function databasePathIn(dataPath: string): string {
  return path.join(dataPath, CORE_MODULE_KEY, 'db', 'kompass.db');
}

/** `<dataPath>/core/media` — die Mediathek ebenso. */
export function mediaPathIn(dataPath: string): string {
  return path.join(dataPath, CORE_MODULE_KEY, 'media');
}

export function createDeps(opts: CreateDepsOptions): AppDeps {
  const databasePath = databasePathIn(opts.dataPath);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  let handle = openDatabase(databasePath);
  const countMigrations = () => (handle.sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
  runMigrations(handle.db);
  const moduleStores = new Map<string, FileStore>(
    [coreModule, ...(opts.modules ?? [])]
      .filter((manifest) => manifest.files)
      .map((manifest) => [manifest.key, createFileStore(path.join(opts.dataPath, manifest.key))]),
  );
  const deps: AppDeps = {
    db: handle.db,
    sqlite: handle.sqlite,
    clock: opts.clock ?? systemClock,
    env: opts.env,
    registry: createRegistry([coreModule, ...(opts.modules ?? [])], { coreTemplates: opts.coreTemplates }),
    media: createFileStore(mediaPathIn(opts.dataPath)),
    files: (moduleKey) => {
      const store = moduleStores.get(moduleKey);
      if (!store) throw new Error(`module without files: true has no store: ${moduleKey}`);
      return store;
    },
    documents: opts.documents ?? noopDocumentEngine,
    textExtraction: opts.textExtraction ?? noopTextExtraction,
    locales: () => readLocales(deps),
    dataPath: opts.dataPath,
    databasePath,
    migrationCount: countMigrations(),
    backupDatabase: (destination) => handle.sqlite.backup(destination).then(() => undefined),
    reopen() {
      handle.sqlite.close();
      handle = openDatabase(databasePath);
      runMigrations(handle.db);
      deps.db = handle.db;
      deps.sqlite = handle.sqlite;
      deps.migrationCount = countMigrations();
    },
    close: () => handle.sqlite.close(),
  };
  return deps;
}

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Ein Volume für alles, was gesichert wird. Geheimnisse werden daneben eingehängt. */
  DATA_PATH: z.string().min(1).default('./data'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSION_SECRET: z.string().min(32),
  KOMPASS_DOCUMENT_TEMPLATES_DIR: z.string().min(1).optional(),
});

export interface RuntimeEnv {
  env: AppEnv;
  dataPath: string;
  port: number;
  sessionSecret: string;
  /** Volume mit den vereinseigenen Basis-Vorlagen; ohne = nur die mitgelieferten. */
  documentTemplatesDir: string | null;
}

export function readEnv(source: Record<string, string | undefined> = process.env): RuntimeEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`invalid environment: ${names}`);
  }
  const v = parsed.data;
  return {
    env: v.APP_ENV,
    dataPath: v.DATA_PATH,
    port: v.PORT,
    sessionSecret: v.SESSION_SECRET,
    documentTemplatesDir: v.KOMPASS_DOCUMENT_TEMPLATES_DIR ?? null,
  };
}
