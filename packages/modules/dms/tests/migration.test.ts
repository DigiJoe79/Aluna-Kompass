import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../core/src/db/migrations');

function applyMigrations(sqlite: Database.Database, opts: { after?: string; upTo?: string } = {}): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let started = !opts.after;
  for (const file of files) {
    const tag = file.replace(/\.sql$/, '');
    if (!started) {
      if (tag === opts.after) started = true;
      continue;
    }
    for (const statement of readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
    if (tag === opts.upTo) return;
  }
}

describe('migration 0016', () => {
  it('zieht die alten Bezüge als about-Link um', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, '0016_dms_links.sql'), 'utf8');
    expect(sql).toContain('INSERT INTO `document_links`');
    expect(sql).toContain("'about'");
    expect(sql).toContain('WHERE');
  });

  /**
   * End-to-end: eine Datenbank auf dem Stand vor dem Umzug (0013), mit einer
   * echten alten `documents`-Zeile, läuft durch 0014–0017. Danach behält die
   * Zeile Nummer und Datei, bekommt eine Dokumentart und ein Dokumentdatum,
   * und ihr alter `entityType`/`entityId`-Bezug steht als `about`-Link.
   */
  it('bewahrt eine vorhandene Zeile über den vollen Umzug hinweg', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite, { upTo: '0013_media_checksum' });

    sqlite
      .prepare("insert into users (id, name, email, password_hash, created_at, updated_at) values ('U1', 'Anna', 'anna@example.org', 'h', 't', 't')")
      .run();
    sqlite
      .prepare("insert into media_assets (id, filename, mime_type, bytes, uploaded_by_user_id, created_at) values ('A1', 'brf-2026-001.pdf', 'application/pdf', 10, 'U1', '2026-05-01T08:00:00.000Z')")
      .run();
    sqlite
      .prepare(
        "insert into documents (id, template_key, number, entity_type, entity_id, input_snapshot, asset_id, status, created_by_user_id, created_at) values ('D1', 'letterhead', 'BRF-2026-001', 'contact', 'C1', '{}', 'A1', 'issued', 'U1', '2026-05-01T08:00:00.000Z')",
      )
      .run();

    applyMigrations(sqlite, { after: '0013_media_checksum' });

    const row = sqlite.prepare('select * from documents where id = ?').get('D1') as Record<string, unknown>;
    expect(row.number).toBe('BRF-2026-001');
    // `asset_id` fiel in 0019 weg: Die Akte hält ihre Dateien seither selbst.
    expect(row.asset_id).toBeUndefined();
    expect(row.type_key).toBe('letter');
    expect(row.phase).toBe('issued');
    expect(row.document_date).toBe('2026-05-01');
    expect(row.updated_at).toBe('2026-05-01T08:00:00.000Z');
    expect(row.entity_type).toBeUndefined(); // Spalte fiel in 0017 weg

    const links = sqlite.prepare('select * from document_links where document_id = ?').all('D1') as Record<string, unknown>[];
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ entity_type: 'contact', entity_id: 'C1', role: 'about' });

    const type = sqlite.prepare("select * from document_types where key = 'letter'").get() as Record<string, unknown>;
    expect(type).toMatchObject({ prefix: 'BRF', retention_class: 'statutory6Y' });

    sqlite.close();
  });
});
