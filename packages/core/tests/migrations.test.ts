import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/db/client';

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const allSql = files.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
const rootVersion = (JSON.parse(readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')) as { version: string }).version;

/**
 * Die Migrationen, die auf `main` ausgeliefert sind oder mit dieser Fassung
 * ausgeliefert werden. Eine Fassung bringt höchstens eine (Prod-Spec,
 * Entscheidung 9). Auf einem `dev-*`-Branch dürfen weitere folgen (9b): Vor der
 * Schlussabnahme werden sie zu einer zusammengelegt, und der Release-Commit
 * trägt diese eine hier ein.
 */
const RELEASED = ['0000_init.sql', '0001_dashboard_layouts.sql', '0002_document_former_numbers.sql'];

/**
 * `drizzle-kit generate` erzeugt nur, was das Schema kennt. Was von Hand
 * angefügt wurde, geht beim Zusammenlegen lautlos verloren — dieser Wächter
 * sagt es vorher. Er durchsucht alle Dateien, nicht nur die erste, weil eine
 * zusammengelegte Migration die Stücke eines Moduls an beliebiger Stelle trägt.
 */
describe('hand-written SQL survives', () => {
  it('starts with 0000_init', () => {
    expect(files[0]).toBe('0000_init.sql');
  });

  it('locks the audit log against update and delete', () => {
    expect(allSql).toContain('CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log');
    expect(allSql).toContain('CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log');
  });

  it('creates the full-text index of the file', () => {
    expect(allSql).toMatch(/CREATE VIRTUAL TABLE `document_text` USING fts5/);
  });

  it('locks finalized finance entries and their lines', () => {
    for (const name of ['finance_entries_final_no_update', 'finance_entries_final_no_delete', 'finance_money_lines_final_no_update', 'finance_money_lines_final_raw_once', 'finance_money_lines_final_no_delete', 'finance_money_lines_final_no_insert', 'finance_allocation_lines_final_no_update', 'finance_allocation_lines_final_no_delete', 'finance_allocation_lines_final_no_insert']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('locks a finance voucher link against retargeting, and against deletion once final', () => {
    for (const name of ['finance_entry_documents_no_retarget', 'finance_entry_documents_document_only_cleared', 'finance_entry_documents_revoke_once', 'finance_entry_documents_final_no_delete']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('locks the settlements of a finalized finance entry', () => {
    for (const name of ['finance_open_item_settlements_final_no_update', 'finance_open_item_settlements_final_no_delete', 'finance_open_item_settlements_final_no_insert']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('keeps an allocation correction permanent — never deleted, its request never rewritten', () => {
    for (const name of ['finance_allocation_corrections_no_delete', 'finance_allocation_corrections_request_immutable']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('keeps a cash count permanent — undeletable, unchangeable except the document gravestone', () => {
    for (const name of ['finance_cash_counts_no_update', 'finance_cash_counts_document_only_cleared', 'finance_cash_counts_no_delete']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('locks a raw transaction against update, and against deletion while a finalized entry books it', () => {
    for (const name of ['finance_raw_transactions_no_update', 'finance_raw_transactions_booked_no_delete']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('freezes an import run — identity always, facts until finished/failed, then only discarding and the file key once', () => {
    for (const name of ['finance_import_runs_identity_immutable', 'finance_import_runs_facts_immutable', 'finance_import_runs_file_key_only_cleared', 'finance_import_runs_discard_once', 'finance_import_runs_no_delete']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('lets a finished, non-discarded run without a closing balance receive one exactly once (Task 2 "Kontostand nachtragen")', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, '0021_finance_import_runs_balance_once.sql'), 'utf8');
    expect(sql).toContain('DROP TRIGGER finance_import_runs_facts_immutable');
    // Die neu erzeugte Fassung des Sperr-Triggers lässt opening_cents/closing_cents aus —
    // die stehen jetzt allein unter finance_import_runs_balance_once. Nur die Kopfzeile
    // (die `UPDATE OF`-Spaltenliste) zählt, nicht der erklärende Kommentar darüber.
    const headerStart = sql.indexOf('CREATE TRIGGER finance_import_runs_facts_immutable');
    const header = sql.slice(headerStart, sql.indexOf('\n', headerStart));
    expect(header).not.toContain('opening_cents');
    expect(header).not.toContain('closing_cents');
    expect(sql).toContain('CREATE TRIGGER finance_import_runs_balance_once ');
  });

  it('lets an import candidate be decided only once', () => {
    expect(allSql, 'finance_import_candidates_decide_once').toContain('CREATE TRIGGER finance_import_candidates_decide_once ');
  });

  it('keeps a CSV format immutable, an account consistent with its format, and the format of a run fixed (F4b)', () => {
    for (const name of [
      'finance_import_profiles_no_update',
      'finance_import_profiles_no_delete_used',
      'finance_accounts_profile_matches_format_insert',
      'finance_accounts_profile_matches_format_update',
      'finance_import_runs_profile_immutable',
    ]) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('refuses an import rule without any condition, on insert and on update (F5)', () => {
    for (const name of ['finance_import_rules_needs_condition_insert', 'finance_import_rules_needs_condition_update']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });
});

describe('the migrations of this version', () => {
  it('on a -dev version the released list is a prefix; on a release it matches exactly', () => {
    if (rootVersion.endsWith('-dev')) {
      expect(files.slice(0, RELEASED.length)).toEqual(RELEASED);
    } else {
      expect(files).toEqual(RELEASED);
    }
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
