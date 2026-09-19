import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/db/client';

/**
 * Seit 0.1.0 beginnt die Datenbank mit einer einzigen Migration: Die dreißig
 * Schritte der Vorlaufzeit wurden am 2026-09-16 zu `0000_init` zusammengelegt,
 * damit jede Fassung auf `main` höchstens eine Migration mitbringt.
 *
 * `drizzle-kit generate` erzeugt nur, was das Schema kennt. Zwei Stücke stehen
 * dort nicht und wurden von Hand angefügt: die Trigger, die das
 * Änderungsprotokoll gegen UPDATE und DELETE sperren (Prinzip 3), und der
 * FTS5-Volltextindex der Akte. Wer die Migrationen je wieder zusammenlegt,
 * verliert beides lautlos — die Tests zu Protokoll und Volltext liefen dann
 * gegen eine Datenbank ohne Sperre und ohne Index. Dieser Wächter sagt es vorher.
 */
describe('the first migration', () => {
  const first = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()[0]!;
  const sql = readFileSync(path.join(MIGRATIONS_DIR, first), 'utf8');

  it('is 0000_init', () => {
    expect(first).toBe('0000_init.sql');
  });

  it('locks the audit log against update and delete', () => {
    expect(sql).toContain('CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log');
    expect(sql).toContain('CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log');
  });

  it('creates the full-text index of the file', () => {
    expect(sql).toMatch(/CREATE VIRTUAL TABLE `document_text` USING fts5/);
  });
});

/**
 * Eine Fassung, höchstens eine Migration (Prod-Spec 2026-09-16, Entscheidung 9).
 * Das Dashboard bringt die erste nach `0000_init`; 0.1.0 startet mit beiden
 * (Prod-Spec, Nachtrag 9a vom 2026-09-17). 0.1.1 bringt
 * `document_former_numbers` fürs Umklassifizieren (Spec 2026-09-19). Wer eine
 * weitere anlegt, ohne dass 0.1.1 ausgeliefert ist, sieht es hier.
 */
describe('the migrations of this version', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  it('are init, dashboard_layouts and — with 0.1.1 — document_former_numbers', () => {
    expect(files).toEqual(['0000_init.sql', '0001_dashboard_layouts.sql', '0002_document_former_numbers.sql']);
  });

  it('keep a former document number unique across documents', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, '0002_document_former_numbers.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE `document_former_numbers`');
    expect(sql).toContain('CREATE UNIQUE INDEX `document_former_numbers_number_idx`');
  });

  it('create the dashboard layout table keyed by user', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, '0001_dashboard_layouts.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE `dashboard_layouts`');
    expect(sql).toMatch(/`user_id` text PRIMARY KEY NOT NULL/);
    expect(sql).toMatch(/FOREIGN KEY \(`user_id`\) REFERENCES `users`\(`id`\)/);
  });
});
