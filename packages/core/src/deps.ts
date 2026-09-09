import type Database from 'better-sqlite3';
import type { Clock } from './clock';
import type { Db } from './db/client';
import type { DocumentEngine } from './documents/engine';
import type { MediaStore } from './media/store';
import type { Registry } from './modules/registry';

export type AppEnv = 'development' | 'test' | 'production';

export interface Deps {
  db: Db;
  sqlite: Database.Database;
  clock: Clock;
  env: AppEnv;
  registry: Registry;
  media: MediaStore;
  documents: DocumentEngine;
  /** Gepflegte Sprachen, erste ist Leitsprache. Als Funktion, damit eine Änderung sofort wirkt. */
  locales: () => string[];
}
