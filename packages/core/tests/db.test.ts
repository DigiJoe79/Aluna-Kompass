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
      'contact_channels',
      'contact_roles',
      'contacts',
      'contacts_user_links',
      'dashboard_layouts',
      'document_counters',
      'document_folders',
      'document_former_numbers',
      'document_links',
      'document_notes',
      'document_relations',
      'document_rules',
      'document_snippets',
      'document_text',
      'document_text_config',
      'document_text_content',
      'document_text_data',
      'document_text_docsize',
      'document_text_idx',
      'document_types',
      'documents',
      'finance_accounts',
      'finance_allocation_corrections',
      'finance_allocation_lines',
      'finance_cash_counts',
      'finance_categories',
      'finance_dated_values',
      'finance_entries',
      'finance_entry_counters',
      'finance_entry_documents',
      'finance_entry_justifications',
      'finance_fiscal_years',
      'finance_money_lines',
      'finance_open_item_settlements',
      'finance_open_items',
      'finance_period_events',
      'finance_project_settings',
      'finance_purposes',
      'follow_ups',
      'media_assets',
      'media_folders',
      'module_provisions',
      'module_provisions_errors',
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
});
