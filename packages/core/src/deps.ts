import type Database from 'better-sqlite3';
import type { Clock } from './clock';
import type { Db } from './db/client';
import type { DocumentEngine } from './documents/engine';
import type { FileStore } from './files/store';
import type { Registry } from './modules/registry';

export type AppEnv = 'development' | 'test' | 'production';

export interface Deps {
  db: Db;
  sqlite: Database.Database;
  clock: Clock;
  env: AppEnv;
  registry: Registry;
  media: FileStore;
  /**
   * Der Dateispeicher eines Moduls, das `files: true` deklariert. Wirft für
   * jedes andere — ein Modul, das Dateien ablegt, ohne es anzumelden, wäre
   * sonst nicht im Backup.
   */
  files(moduleKey: string): FileStore;
  documents: DocumentEngine;
  /** Gepflegte Sprachen, erste ist Leitsprache. Als Funktion, damit eine Änderung sofort wirkt. */
  locales: () => string[];
}
