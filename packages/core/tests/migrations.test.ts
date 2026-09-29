import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/db/client';

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const allSql = files.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
/** Die zuletzt angelegte Fassung eines Triggers — bis zu seinem `END;`. */
const lastTrigger = (name: string) => {
  const at = allSql.lastIndexOf(`CREATE TRIGGER ${name} `);
  return at < 0 ? '' : allSql.slice(at, allSql.indexOf('END;', at));
};
const rootVersion = (JSON.parse(readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')) as { version: string }).version;

/**
 * Die Migrationen, die auf `main` ausgeliefert sind oder mit dieser Fassung
 * ausgeliefert werden. Eine Fassung bringt höchstens eine (Prod-Spec,
 * Entscheidung 9). Auf einem `dev-*`-Branch dürfen weitere folgen (9b): Vor der
 * Schlussabnahme werden sie zu einer zusammengelegt und hier eingetragen.
 * `0003_finance` ist die zusammengelegte Migration der Fassung 0.2.0,
 * `0004_finance_0_2_1` die der Fassung 0.2.1.
 */
const RELEASED = ['0000_init.sql', '0001_dashboard_layouts.sql', '0002_document_former_numbers.sql', '0003_finance.sql', '0004_finance_0_2_1.sql'];

/**
 * Was eine Produktion schon ausgeführt hat, bleibt Byte für Byte, wie es war:
 * sha256 über den Dateiinhalt, so wie `drizzle-orm/migrator` rechnet und wie er
 * in `__drizzle_migrations` einer Installation der Fassung 0.2.0 steht (0003 seit deren Release).
 */
const SHIPPED_HASHES: Record<string, string> = {
  '0000_init.sql': '90c7ee099e9b814f38c7f5accdeb020aeb30e6108864630bafd95519ad85d124',
  '0001_dashboard_layouts.sql': '200b81c11fa9739d331e1099bb5998e8628b151ccdfddf5812d144fae72d2705',
  '0002_document_former_numbers.sql': '3d54523a6aef7a9555caaacb15bbc3ab731e4a4314f5c9aa70c6717c7fc0f697',
  '0003_finance.sql': '8e2b6d69c78f801453fee3b1977a2f779ddbd8a48b5fc4187fd27abcc169409a',
};

/**
 * `when` der letzten Migration vor dem Zusammenlegen (0040, 2026-09-28). Der
 * Migrator vergleicht nur `created_at` der jüngsten Zeile mit `when`: Trägt die
 * zusammengelegte Migration denselben Wert, gilt eine Datenbank aus der alten
 * Reihe als aktuell und bekommt nichts doppelt.
 */
const LAST_WHEN_BEFORE_SQUASH_0_2_0 = 1790605068196;
/**
 * `when` der letzten Migration vor dem Zusammenlegen der Fassung 0.2.1 (2026-09-29). Wie oben: Trägt
 * `0004_finance_0_2_1` denselben Wert, gilt eine Testinstanz aus der unzusammengelegten Reihe als aktuell.
 */
const LAST_WHEN_BEFORE_SQUASH_0_2_1 = 1790702142322;
const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; when: number; tag: string }[] };

/**
 * `drizzle-kit generate` erzeugt nur, was das Schema kennt. Was von Hand
 * angefügt wurde, geht beim Zusammenlegen lautlos verloren — dieser Wächter
 * sagt es vorher. Er durchsucht alle Dateien, nicht nur die erste, weil eine
 * zusammengelegte Migration die Stücke eines Moduls an beliebiger Stelle trägt.
 */
describe('hand-written SQL survives', () => {
  it('keeps at most one active open item per document as a partial unique index', () => {
    expect(allSql).toMatch(/CREATE UNIQUE INDEX `finance_open_items_document_active_idx`[^;]*WHERE[^;]*cancelled_at/);
  });

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

  it('locks what the finance manifest calls undeletable (0.2.1, Befund 4)', () => {
    for (const name of ['finance_fiscal_years_no_delete', 'finance_period_events_no_delete', 'finance_open_items_no_delete', 'finance_entry_justifications_no_delete', 'finance_not_return_marks_no_delete', 'finance_partner_notices_no_delete', 'finance_in_kind_details_final_no_delete', 'finance_import_candidates_booked_no_delete']) {
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
    expect(allSql).toContain('DROP TRIGGER finance_import_runs_facts_immutable');
    // Die jüngste Fassung des Sperr-Triggers lässt opening_cents/closing_cents aus —
    // die stehen allein unter finance_import_runs_balance_once. Nur die Kopfzeile
    // (die `UPDATE OF`-Spaltenliste) zählt, nicht der erklärende Kommentar darüber.
    const trigger = lastTrigger('finance_import_runs_facts_immutable');
    const header = trigger.slice(0, trigger.indexOf('\n'));
    expect(header).toContain('BEFORE UPDATE OF');
    expect(header).not.toContain('opening_cents');
    expect(header).not.toContain('closing_cents');
    expect(allSql).toContain('CREATE TRIGGER finance_import_runs_balance_once ');
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

  it('keeps notices, signers, confirmations and their lines permanent; a line is released once (F6a)', () => {
    for (const name of [
      'finance_notices_no_delete',
      'finance_notices_supersede_once',
      'finance_notices_void_once',
      'finance_signers_no_delete',
      'finance_confirmations_no_delete',
      'finance_confirmations_immutable',
      'finance_confirmations_void_once',
      'finance_confirmations_trail_once',
      'finance_confirmations_signed_once',
      'finance_confirmation_lines_no_delete',
      'finance_confirmation_lines_release_once',
    ]) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
    expect(allSql).toContain('CREATE UNIQUE INDEX `finance_confirmation_lines_line_idx` ON `finance_confirmation_lines` (`line_id`) WHERE "finance_confirmation_lines"."released_at" is null');
    // N4: Ein Neuaufbau von finance_notices (etwa beim Zusammenlegen) verwirft ihre Trigger — sie müssen danach neu dastehen.
    const rebuild = allSql.lastIndexOf('`__new_finance_notices`');
    for (const name of ['finance_notices_no_delete', 'finance_notices_supersede_once', 'finance_notices_void_once']) {
      expect(allSql.lastIndexOf(`CREATE TRIGGER ${name} `), name).toBeGreaterThan(rebuild);
    }
  });

  it('keeps confirmation runs and their items permanent; late facts and the outcome of an item are set once (F6b)', () => {
    for (const name of [
      'finance_confirmation_runs_no_delete',
      'finance_confirmation_runs_immutable',
      'finance_confirmation_run_items_no_delete',
      'finance_confirmation_run_items_done_once',
    ]) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
    expect(allSql).toContain('CREATE UNIQUE INDEX `finance_confirmation_run_items_key_idx` ON `finance_confirmation_run_items` (`run_id`,`contact_id`,`kind`,`in_kind_line_id`)');
    // N4: Die Begründung vor dem ältesten Bescheid ist entfallen — die jüngsten Wächter nennen die Spalte nicht mehr.
    expect(lastTrigger('finance_confirmation_runs_immutable')).toContain('OR NEW.created_at IS NOT OLD.created_at');
    expect(lastTrigger('finance_confirmation_runs_immutable')).not.toContain('pre_notice_reason');
    expect(lastTrigger('finance_confirmations_immutable')).toContain('period_to, created_at ON finance_confirmations');
    expect(lastTrigger('finance_confirmations_immutable')).not.toContain('pre_notice_reason');
    expect(allSql).toContain('CREATE UNIQUE INDEX `finance_confirmation_run_items_collective_idx` ON `finance_confirmation_run_items` (`run_id`,`contact_id`,`kind`) WHERE "finance_confirmation_run_items"."in_kind_line_id" is null');
  });

  it('keeps a submitted expense claim and its positions permanent; only approval fields move, state leaves submitted once (F8a)', () => {
    for (const name of [
      'finance_expense_claims_no_delete_submitted',
      'finance_expense_claims_draft_only_submits',
      'finance_expense_claims_submitted_immutable',
      'finance_expense_positions_immutable_after_submit',
      'finance_expense_positions_no_insert_after_submit',
      'finance_expense_positions_no_delete_after_submit',
    ]) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('refuses an import rule without any condition, on insert and on update (F5)', () => {
    for (const name of ['finance_import_rules_needs_condition_insert', 'finance_import_rules_needs_condition_update']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('keeps a submitted partner payment, its positions, paid lines and acknowledged evidence permanent (F7)', () => {
    for (const name of [
      'finance_partner_payments_no_delete_submitted',
      'finance_partner_payments_draft_only_submits',
      'finance_partner_payments_submitted_immutable',
      'finance_partner_payment_positions_no_insert_after_submit',
      'finance_partner_payment_positions_no_update_after_submit',
      'finance_partner_payment_positions_no_delete_after_submit',
      'finance_partner_paid_lines_no_insert_after_submit',
      'finance_partner_paid_lines_no_delete_after_submit',
      'finance_partner_evidence_immutable_after_ack',
      'finance_partner_evidence_no_delete_after_ack',
    ]) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
    // Design-Nachtrag Phase 4 (Entscheidung 2): die Nachweisfrist in Monaten ist ab dem Einreichen fest.
    expect(lastTrigger('finance_partner_payments_submitted_immutable')).toContain('NEW.proof_months IS NOT OLD.proof_months');
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

  it('leave what a production already ran byte for byte unchanged', () => {
    for (const [file, hash] of Object.entries(SHIPPED_HASHES)) {
      expect(createHash('sha256').update(readFileSync(path.join(MIGRATIONS_DIR, file))).digest('hex'), file).toBe(hash);
    }
  });

  it('let a database from the unsquashed 0.2.0 series count as current (same `when` as its last migration)', () => {
    const squashed = journal.entries.find((e) => e.tag === '0003_finance');
    expect(squashed?.when).toBe(LAST_WHEN_BEFORE_SQUASH_0_2_0);
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
  });

  it('let a database from the unsquashed 0.2.1 series count as current (same `when` as its last migration)', () => {
    const squashed = journal.entries.find((e) => e.tag === '0004_finance_0_2_1');
    expect(squashed?.when).toBe(LAST_WHEN_BEFORE_SQUASH_0_2_1);
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
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
