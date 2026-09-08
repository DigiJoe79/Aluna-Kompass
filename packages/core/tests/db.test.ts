import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from '../src/db/client';
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
      'site_entries',
      'site_publishes',
      'site_template_state',
      'site_values',
      'user_roles',
      'users',
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

  /**
   * Der Cutover nimmt dem Kern die Rechte des Webseiten-Moduls. Ohne diesen
   * Schritt stünden nach dem Update Rollen da, die Projekte pflegen sollen,
   * es aber nicht mehr dürfen — und `site.blockedTerms` wäre leer, obwohl der
   * Verein seine Sperrwortliste gepflegt hat.
   */
  it('migration 0010 carries the website rights and the blocked terms over', () => {
    const { sqlite } = createTestDb();
    sqlite.prepare("insert into roles (id, name, description, is_protected, created_at) values ('R1', 'Redaktion', '', 0, 't')").run();
    for (const key of ['website.view', 'website.manage', 'animals.view']) {
      sqlite.prepare('insert into role_permissions (role_id, permission_key) values (?, ?)').run('R1', key);
    }
    sqlite.prepare("insert into settings (key, value, updated_at) values ('website.blockedTerms', '[\"Notfall\"]', 't')").run();

    const file = readFileSync(path.join(MIGRATIONS_DIR, '0010_open_eternals.sql'), 'utf8');
    for (const statement of file.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => !s.startsWith('DROP TABLE'))) {
      sqlite.prepare(statement).run();
    }

    const keys = (sqlite.prepare('select permission_key from role_permissions where role_id = ?').all('R1') as { permission_key: string }[]).map((r) => r.permission_key).sort();
    expect(keys).toEqual(['animals.view', 'projects.manage', 'projects.view']);
    const terms = sqlite.prepare("select value from settings where key = 'site.blockedTerms'").get() as { value: string } | undefined;
    expect(JSON.parse(terms!.value)).toEqual(['Notfall']);
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
