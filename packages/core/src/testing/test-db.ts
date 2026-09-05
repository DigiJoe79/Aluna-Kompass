import type Database from 'better-sqlite3';
import { openDatabase, runMigrations, type Db } from '../db/client';

export function createTestDb(): { db: Db; sqlite: Database.Database } {
  const { db, sqlite } = openDatabase(':memory:');
  runMigrations(db);
  return { db, sqlite };
}
