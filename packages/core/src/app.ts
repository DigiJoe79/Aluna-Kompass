import { z } from 'zod';
import { systemClock, type Clock } from './clock';
import { coreModule } from './core-module';
import { openDatabase, runMigrations } from './db/client';
import type { AppEnv, Deps } from './deps';
import { createFileMediaStore } from './media/store';
import type { DocumentTemplate, ModuleManifest } from './modules/manifest';
import { createRegistry } from './modules/registry';

export interface CreateDepsOptions {
  databasePath: string;
  mediaPath: string;
  env: AppEnv;
  modules?: ModuleManifest[];
  coreTemplates?: DocumentTemplate[];
  clock?: Clock;
}

export type AppDeps = Deps & {
  databasePath: string;
  migrationCount: number;
  backupDatabase(destination: string): Promise<void>;
  reopen(): void;
  close(): void;
};

export function createDeps(opts: CreateDepsOptions): AppDeps {
  let handle = openDatabase(opts.databasePath);
  const countMigrations = () => (handle.sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
  runMigrations(handle.db);
  const deps: AppDeps = {
    db: handle.db,
    clock: opts.clock ?? systemClock,
    env: opts.env,
    registry: createRegistry([coreModule, ...(opts.modules ?? [])], { coreTemplates: opts.coreTemplates }),
    media: createFileMediaStore(opts.mediaPath),
    databasePath: opts.databasePath,
    migrationCount: countMigrations(),
    backupDatabase: (destination) => handle.sqlite.backup(destination).then(() => undefined),
    reopen() {
      handle.sqlite.close();
      handle = openDatabase(opts.databasePath);
      runMigrations(handle.db);
      deps.db = handle.db;
      deps.migrationCount = countMigrations();
    },
    close: () => handle.sqlite.close(),
  };
  return deps;
}

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().min(1).default('./data/kompass.db'),
  MEDIA_PATH: z.string().min(1).default('./media'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSION_SECRET: z.string().min(32),
});

export interface RuntimeEnv {
  env: AppEnv;
  databasePath: string;
  mediaPath: string;
  port: number;
  sessionSecret: string;
}

export function readEnv(source: Record<string, string | undefined> = process.env): RuntimeEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`invalid environment: ${names}`);
  }
  const v = parsed.data;
  return { env: v.APP_ENV, databasePath: v.DATABASE_PATH, mediaPath: v.MEDIA_PATH, port: v.PORT, sessionSecret: v.SESSION_SECRET };
}
