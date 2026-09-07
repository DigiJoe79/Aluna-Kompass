import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/client';
import { sessions } from '../src/db/schema';
import { createTestDb } from '../src/testing/test-db';

describe('database', () => {
  it('applies migrations and creates all core tables', () => {
    const { sqlite } = createTestDb();
    const rows = sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
      )
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      'animal_photos',
      'animal_stories',
      'animals',
      'api_tokens',
      'audit_log',
      'documents',
      'media_assets',
      'projects',
      'role_permissions',
      'roles',
      'sessions',
      'settings',
      'user_roles',
      'users',
      'website_articles',
      'website_downloads',
      'website_faqs',
      'website_pages',
      'website_publishes',
      'website_team',
    ]);
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

  it('migration 0006 sets ["de","en"] for existing databases with users', () => {
    const { sqlite } = createTestDb();
    sqlite.prepare("insert into users (id, email, name, password_hash, created_at, updated_at) values ('U1', 'test@test.de', 'Test', 'h', 't', 't')").run();
    sqlite.prepare(`
      insert into settings (key, value, updated_at)
      select 'i18n.locales', '["de","en"]', '1970-01-01T00:00:00.000Z'
      where exists (select 1 from users)
        and not exists (select 1 from settings where key = 'i18n.locales')
    `).run();
    const row = sqlite.prepare("select value from settings where key = 'i18n.locales'").get() as { value: string };
    expect(JSON.parse(row.value)).toEqual(['de', 'en']);
  });
});
