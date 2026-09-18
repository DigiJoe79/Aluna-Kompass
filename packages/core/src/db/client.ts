import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Im Container-Bundle zeigt import.meta.url nicht auf die Paketdateien; dann setzt der Container KOMPASS_MIGRATIONS_DIR auf den echten Pfad. */
export function resolveMigrationsDir(env: Record<string, string | undefined> = process.env): string {
  return env.KOMPASS_MIGRATIONS_DIR ?? MIGRATIONS_DIR;
}

export function openDatabase(filePath: string): { db: Db; sqlite: Database.Database } {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: resolveMigrationsDir() });
}
