import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/client';
import { existsSync, readdirSync } from 'node:fs';
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as coreSchema from '../src/db/schema';
import { sessions } from '../src/db/schema';
import { createTestDb } from '../src/testing/test-db';

describe('database', () => {
  /**
   * Jede Tabelle, die ein Drizzle-Schema beschreibt (Kern und alle Module, wie `drizzle.config.ts` sie liest), steht
   * nach den Migrationen in der Datenbank. Früher zählte der Test alle Tabellennamen von Hand auf; jede neue Tabelle
   * brauchte hier eine Zeile, ohne dass der Test eine vergessene Migration besser fand als dieser Abgleich.
   */
  it('applies migrations and creates every table the schemas describe', async () => {
    const modules = new URL('../../modules/', import.meta.url);
    const files = readdirSync(modules).map((dir) => new URL(`${dir}/src/schema.ts`, modules)).filter((file) => existsSync(file));
    const schemas = [coreSchema, ...(await Promise.all(files.map((file) => import(file.href) as Promise<unknown>)))];
    const described = schemas.flatMap((mod) => Object.values(mod as Record<string, unknown>).filter((v) => is(v, SQLiteTable)).map((t) => getTableConfig(t as SQLiteTable).name));
    expect(described.length).toBeGreaterThan(100);
    const { sqlite } = createTestDb();
    const present = new Set((sqlite.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name));
    expect(described.filter((name) => !present.has(name))).toEqual([]);
  });

  it('enforces foreign keys', () => {
    const { db, sqlite } = createTestDb();
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      db
        .insert(sessions)
        .values({ id: 'S1', userId: 'missing', createdAt: 'x', expiresAt: 'y' })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('runs migrations idempotently', () => {
    const { db } = createTestDb();
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('honours KOMPASS_MIGRATIONS_DIR', async () => {
    const { MIGRATIONS_DIR, resolveMigrationsDir } = await import('../src/db/client');
    expect(resolveMigrationsDir({})).toBe(MIGRATIONS_DIR);
    expect(resolveMigrationsDir({ KOMPASS_MIGRATIONS_DIR: '/srv/migrations' })).toBe('/srv/migrations');
  });
});
