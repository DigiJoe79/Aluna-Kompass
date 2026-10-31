import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
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
 * `0004_finance_0_2_1` die der Fassung 0.2.1. `0005_animals_review` ist die eine Migration der Fassung 0.2.2
 * (nie zusammengelegt: Der Branch hatte nur diese). `0006_audit_params` ist die der Fassung 0.2.9 (Protokoll in Sätzen),
 * `0007_animal_proposals_site_manifest` die zusammengelegte der Fassung 0.2.10 (Vorschlags-Eingang, „nicht publiziert“),
 * `0008_image_crops` die eine der Fassung 0.2.11 (Bildausschnitt an Geschichte und Projektbild),
 * `0009_members_direct_debit_0_3_0` die zusammengelegte der Fassung 0.3.0 (Mitglieder, Lastschrift, Versand per E-Mail),
 * `0010_media_ai_kind_finance_locks_0_3_1` die zusammengelegte der Fassung 0.3.1 (Bildkennzeichnung, Trigger an
 * gesperrten Finanzspalten; 0.3.2 brachte keine), `0011_finance_accountability_0_4_0` die zusammengelegte der
 * Fassung 0.4.0 (Rechenschaftspflichten: Berichte, Kassenprüfung, Abschluss, Erklärungszeiträume, USt-Abgaben),
 * `0012_governance_annual_accounts_0_5_0` die zusammengelegte der Fassung 0.5.0 (Gremien; dazu die nie einzeln
 * ausgelieferte 0.4.5 mit Jahresrechnung und Mittelverwendung, samt ihren Triggern),
 * `0013_dms_unclassified_labels_0_5_1` die eine der Fassung 0.5.1 (nur Daten: Backlog 63).
 */
const RELEASED = ['0000_init.sql', '0001_dashboard_layouts.sql', '0002_document_former_numbers.sql', '0003_finance.sql', '0004_finance_0_2_1.sql', '0005_animals_review.sql', '0006_audit_params.sql', '0007_animal_proposals_site_manifest.sql', '0008_image_crops.sql', '0009_members_direct_debit_0_3_0.sql', '0010_media_ai_kind_finance_locks_0_3_1.sql', '0011_finance_accountability_0_4_0.sql', '0012_governance_annual_accounts_0_5_0.sql', '0013_dms_unclassified_labels_0_5_1.sql'];

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
  // Seit dem Release der Fassung 0.2.1.
  '0004_finance_0_2_1.sql': '80558554c1a9f90bf52e6dd8887f4bf3dec48b724d295fc63d23378023d36bda',
  // Seit dem Release der Fassung 0.2.2.
  '0005_animals_review.sql': 'adf63e1536b9f8e6d742109617ae9f21a2cb5424a1d13bf492e6c2bebf246452',
  // Seit dem Release der Fassung 0.2.9.
  '0006_audit_params.sql': 'b34144ee8d237925c4d3e4432d2fac66f6ca69f6ca0c806ccf376e6f830cdb78',
  // Seit dem Release der Fassung 0.2.10.
  '0007_animal_proposals_site_manifest.sql': '7a818b30bbc0395f4439557116e47e12f1887da0f472ee16865979875e5f5a71',
  // Seit dem Release der Fassung 0.2.11.
  '0008_image_crops.sql': '4c5b6a76677c943b0d3c0a5316b1d421d64ee9c51822b28a601da784c529f7c3',
  // Seit dem Release der Fassung 0.3.0.
  '0009_members_direct_debit_0_3_0.sql': 'e094c020544cf97ba8c8642b3b7b5ea691c4e32266f3233f2531399dca2991d6',
  // Seit dem Release der Fassung 0.3.1 (0.3.2 ohne Migration).
  '0010_media_ai_kind_finance_locks_0_3_1.sql': '1d193e4dfae91ce53378f18c358a6e73870049ccb84531b94c82073f2758338e',
  // Seit dem Release der Fassung 0.5.1.
  '0013_dms_unclassified_labels_0_5_1.sql': '9b945cf4dcb16bfb7b60377e0db9bb78ae1ca3cad7e3c9041be98afa324314ec',
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
/**
 * `when` der letzten Migration vor dem Zusammenlegen der Fassung 0.2.10 (`0008_site_content_manifest`, 2026-10-10).
 * Wie oben: Trägt `0007_animal_proposals_site_manifest` denselben Wert, gilt eine Testinstanz aus der
 * unzusammengelegten Reihe (9 Migrationszeilen) als aktuell und bekommt nichts doppelt.
 */
const LAST_WHEN_BEFORE_SQUASH_0_2_10 = 1791590317073;
/**
 * `when` der letzten Migration vor dem Zusammenlegen der Fassung 0.3.0 (`0032_freezing_justin_hammer`, 2026-10-19).
 * Wie oben: Trägt `0009_members_direct_debit_0_3_0` denselben Wert, gilt eine Testinstanz aus der
 * unzusammengelegten Reihe (33 Migrationszeilen) als aktuell und bekommt nichts doppelt.
 */
const LAST_WHEN_BEFORE_SQUASH_0_3_0 = 1792425401332;
/**
 * `when` der letzten Migration vor dem Zusammenlegen der Fassung 0.3.1 (`0011_finance_locked_columns`, 2026-10-22).
 * Wie oben: Trägt `0010_media_ai_kind_finance_locks_0_3_1` denselben Wert, gilt eine Instanz aus der
 * unzusammengelegten Reihe (12 Migrationszeilen, z. B. der Dev-Container) als aktuell und bekommt nichts doppelt.
 */
const LAST_WHEN_BEFORE_SQUASH_0_3_1 = 1792677288187;
/**
 * `when` der letzten Migration vor dem Zusammenlegen der Fassung 0.4.0 (`0060_finance_vat_filings_update`, 2026-10-27).
 * Wie oben: Trägt `0011_finance_accountability_0_4_0` denselben Wert, gilt eine Instanz aus der
 * unzusammengelegten Reihe (61 Migrationszeilen: Dev-Container, Test, E2E) als aktuell und bekommt nichts doppelt.
 */
const LAST_WHEN_BEFORE_SQUASH_0_4_0 = 1792967481969;
const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; when: number; tag: string }[] };

/**
 * `drizzle-kit generate` erzeugt nur, was das Schema kennt. Was von Hand
 * angefügt wurde, geht beim Zusammenlegen lautlos verloren — dieser Wächter
 * sagt es vorher. Er durchsucht alle Dateien, nicht nur die erste, weil eine
 * zusammengelegte Migration die Stücke eines Moduls an beliebiger Stelle trägt.
 */
describe('Daten-Migration 0.5.1 (Backlog 63)', () => {
  it('benennt die Startarten nur um, wenn der Verein sie nicht selbst benannt hat', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE document_types (key text PRIMARY KEY, label text NOT NULL)');
    const add = db.prepare('INSERT INTO document_types VALUES (?, ?)');
    add.run('unclassified-in', 'Unklassifiziert (Eingang)');
    add.run('unclassified-out', 'Post raus');
    add.run('letter', 'Unklassifiziert (Ausgang)');
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, '0013_dms_unclassified_labels_0_5_1.sql'), 'utf8'));
    const labels = Object.fromEntries((db.prepare('SELECT key, label FROM document_types').all() as { key: string; label: string }[]).map((r) => [r.key, r.label]));
    expect(labels).toEqual({ 'unclassified-in': 'Eingang ohne Zuordnung', 'unclassified-out': 'Post raus', letter: 'Unklassifiziert (Ausgang)' });
    db.prepare("UPDATE document_types SET label = 'Unklassifiziert (Ausgang)' WHERE key = 'unclassified-out'").run();
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, '0013_dms_unclassified_labels_0_5_1.sql'), 'utf8'));
    expect((db.prepare("SELECT label FROM document_types WHERE key = 'unclassified-out'").get() as { label: string }).label).toBe('Ausgang ohne Zuordnung');
  });
});

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

  it('keeps mandates, pledges, pre-notifications and direct debit runs permanent (0.3.0, L1/L2)', () => {
    for (const name of ['finance_sepa_mandates_no_delete', 'finance_pledges_no_delete', 'finance_sepa_prenotifications_no_delete', 'finance_direct_debit_runs_no_delete', 'finance_direct_debit_items_no_delete']) {
      expect(allSql, name).toContain(`CREATE TRIGGER ${name} `);
    }
  });

  it('freezes mandate reference, creditor id and the direct debit item of a final line (0.3.0, L3)', () => {
    expect(lastTrigger('finance_raw_transactions_no_update')).toContain('mandate_reference, creditor_id');
    expect(lastTrigger('finance_allocation_lines_final_no_update')).toContain('direct_debit_item_id');
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

  it('let a database from the unsquashed 0.2.10 series count as current (same `when` as its last migration)', () => {
    const squashed = journal.entries.find((e) => e.tag === '0007_animal_proposals_site_manifest');
    expect(squashed?.when).toBe(LAST_WHEN_BEFORE_SQUASH_0_2_10);
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
  });

  it('let a database from the unsquashed 0.3.0 series count as current (same `when` as its last migration)', () => {
    const squashed = journal.entries.find((e) => e.tag === '0009_members_direct_debit_0_3_0');
    expect(squashed?.when).toBe(LAST_WHEN_BEFORE_SQUASH_0_3_0);
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
  });

  it('let a database from the unsquashed 0.3.1 series count as current (same `when` as its last migration)', () => {
    const squashed = journal.entries.find((e) => e.tag === '0010_media_ai_kind_finance_locks_0_3_1');
    expect(squashed?.when).toBe(LAST_WHEN_BEFORE_SQUASH_0_3_1);
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
  });

  it('let a database from the unsquashed 0.4.0 series count as current (same `when` as its last migration)', () => {
    const squashed = journal.entries.find((e) => e.tag === '0011_finance_accountability_0_4_0');
    expect(squashed?.when).toBe(LAST_WHEN_BEFORE_SQUASH_0_4_0);
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

/** Führt eine Migrationsdatei so aus, wie der Migrator sie liest: Stücke an `--> statement-breakpoint`. */
const applyMigration = (db: Database.Database, file: string) => {
  for (const part of readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split('--> statement-breakpoint')) {
    if (part.trim()) db.exec(part);
  }
};
const applyMigrationsUpTo = (db: Database.Database, last: string) => {
  for (const file of files.slice(0, files.indexOf(last) + 1)) applyMigration(db, file);
};
const SQUASHED_0_4_0 = '0011_finance_accountability_0_4_0.sql';
/**
 * Die zusammengelegte 0011 trägt vor jedem Stück `-- Quelle: <alte Datei>`. Für einen Übertrag, dessen
 * Ausgangstabelle erst innerhalb von 0.4.0 entstand (`finance_vat_returns`), führt dies 0011 nur bis vor
 * (`until`) oder ab (`from`) einer Quelle aus — Zeilen dazwischen stehen dann im Zwischenstand von damals.
 */
const applySquashedPart = (db: Database.Database, part: { from?: string; until?: string }) => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, SQUASHED_0_4_0), 'utf8');
  const at = (source: string) => {
    const i = sql.indexOf(`-- Quelle: ${source}\n`);
    if (i < 0) throw new Error(`Quelle ${source} fehlt in ${SQUASHED_0_4_0}`);
    return i;
  };
  const slice = sql.slice(part.from ? at(part.from) : 0, part.until ? at(part.until) : sql.length);
  for (const piece of slice.split('--> statement-breakpoint')) {
    if (piece.replace(/^--.*$/gm, '').trim()) db.exec(piece);
  }
};

describe('migration 0006 (Protokoll in Sätzen)', () => {
  it('0006 keeps old audit entries, drops summary, adds params, and keeps the log immutable', () => {
    const db = new Database(':memory:');
    applyMigrationsUpTo(db, '0005_animals_review.sql');
    db.prepare(`INSERT INTO audit_log (id, occurred_at, user_id, channel, action, entity_type, entity_id, before, after, summary, api_token_id, ip_address, request_id, environment)
      VALUES ('A1', '2026-10-01T12:00:00.000Z', NULL, 'system', 'animals.update', 'animal', 'X1', NULL, NULL, 'Tier „Bello“ geändert', NULL, NULL, 'R1', 'test')`).run();
    applyMigration(db, '0006_audit_params.sql');
    const columns = (db.prepare(`PRAGMA table_info(audit_log)`).all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain('params');
    expect(columns).not.toContain('summary');
    expect(db.prepare(`SELECT action, params FROM audit_log WHERE id = 'A1'`).get()).toEqual({ action: 'animals.update', params: null });
    expect(() => db.prepare(`UPDATE audit_log SET action = 'x' WHERE id = 'A1'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM audit_log WHERE id = 'A1'`).run()).toThrow(/immutable/);
    db.close();
  });
});

describe('migration 0007 (Vorschlags-Eingang der Tiere, Publish-Stand je Datensatz)', () => {
  it('keeps existing animal photos, adds empty crop and source, creates the proposal tables', () => {
    const db = new Database(':memory:');
    applyMigrationsUpTo(db, '0006_audit_params.sql');
    db.exec(`INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES ('U1', 'A', 'a@example.org', 'x', 't', 't');
      INSERT INTO media_assets (id, filename, mime_type, bytes, created_at) VALUES ('M1', 'm.png', 'image/png', 1, 't');
      INSERT INTO animals (id, slug, name, sex, birth_text, size_text, summary, body, created_at, updated_at) VALUES ('A1', 'luna-a1a1', 'Luna', 'female', '{}', '{}', '{}', '{}', 't', 't');
      INSERT INTO animal_photos (animal_id, asset_id, sort_order, is_primary) VALUES ('A1', 'M1', 1, 1);`);
    applyMigration(db, '0007_animal_proposals_site_manifest.sql');
    expect(db.prepare(`SELECT asset_id, is_primary, crop, source_user_id, source_ref FROM animal_photos`).get()).toEqual({ asset_id: 'M1', is_primary: 1, crop: null, source_user_id: null, source_ref: null });
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['animal_proposals', 'animal_proposal_images', 'animal_origins']));
    // Je Quelle und Tier höchstens eine offene Änderung — der Index sagt es, nicht nur der Dienst.
    const insert = db.prepare(`INSERT INTO animal_proposals (id, source_user_id, source_key, kind, animal_id, state, created_at, updated_at) VALUES (?, 'U1', ?, 'update', 'A1', ?, 't', 't')`);
    insert.run('P1', 'k1', 'open');
    expect(() => insert.run('P2', 'k2', 'open')).toThrow(/UNIQUE/);
    insert.run('P3', 'k3', 'replaced');
    db.close();
  });
});

describe('migration 0009 (Mitglieder, Lastschrift, Versand per E-Mail)', () => {
  it('backfills the filing date of issued documents and leaves drafts alone', () => {
    const db = new Database(':memory:');
    applyMigrationsUpTo(db, '0008_image_crops.sql');
    db.exec(`INSERT INTO document_types (key, label, prefix, default_direction, retention_class) VALUES ('letter', 'Brief', 'BR', 'outgoing', 'business');
      INSERT INTO documents (id, phase, type_key, document_date, created_by_user_id, created_at, updated_at) VALUES ('D1', 'issued', 'letter', '2026-08-01', 'U1', '2026-08-01T10:00:00.000Z', 't');
      INSERT INTO documents (id, phase, type_key, document_date, created_by_user_id, created_at, updated_at) VALUES ('D2', 'draft', 'letter', '2026-08-02', 'U1', '2026-08-02T10:00:00.000Z', 't');`);
    applyMigration(db, '0009_members_direct_debit_0_3_0.sql');
    expect(db.prepare(`SELECT id, filed_at FROM documents ORDER BY id`).all()).toEqual([
      { id: 'D1', filed_at: '2026-08-01T10:00:00.000Z' },
      { id: 'D2', filed_at: null },
    ]);
    db.close();
  });
});

describe('migration 0011 (0.4.0), aus 0048/0049 (Rechenschaft D2: Erklärungszeitraum statt „Steuererklärung abgegeben am“)', () => {
  it('turns every filed year into a one-year tax period with the id of the year, and drops the column', () => {
    const db = new Database(':memory:');
    applyMigrationsUpTo(db, '0010_media_ai_kind_finance_locks_0_3_1.sql');
    db.exec(`INSERT INTO finance_fiscal_years (id, starts_on, ends_on, designation, tax_return_filed_on, created_at, updated_at) VALUES ('01JYEAR2025AAAAAAAAAAAAAAA', '2025-01-01', '2025-12-31', '2025', '2026-05-31', 't', 't');
      INSERT INTO finance_fiscal_years (id, starts_on, ends_on, designation, tax_return_filed_on, created_at, updated_at) VALUES ('01JYEAR2026AAAAAAAAAAAAAAA', '2026-01-01', '2026-12-31', '2026', NULL, 't', 't');`);
    applyMigration(db, SQUASHED_0_4_0);
    expect(db.prepare('SELECT id, first_fiscal_year_id AS first, last_fiscal_year_id AS last, due_on AS dueOn, filed_on AS filedOn, filed_report_id AS report, answers_json AS answers, with_tax_advisor AS advisor FROM finance_tax_periods').all()).toEqual([
      { id: '01JYEAR2025AAAAAAAAAAAAAAA', first: '01JYEAR2025AAAAAAAAAAAAAAA', last: '01JYEAR2025AAAAAAAAAAAAAAA', dueOn: '2026-07-31', filedOn: '2026-05-31', report: null, answers: '{}', advisor: 0 },
    ]);
    const columns = (db.prepare('PRAGMA table_info(finance_fiscal_years)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).not.toContain('tax_return_filed_on');
    // Die Löschsperren am Geschäftsjahr und am Zeitraum überleben das DROP COLUMN.
    expect(() => db.prepare(`DELETE FROM finance_fiscal_years WHERE id = '01JYEAR2026AAAAAAAAAAAAAAA'`).run()).toThrow(/permanent/);
    expect(() => db.prepare('DELETE FROM finance_tax_periods').run()).toThrow(/permanent/);
    db.close();
  });
});


describe('migration 0011 (0.4.0), aus 0051 (E6a: „Unternehmer oder USt-IdNr.“ wird datierte Einstellung)', () => {
  it('turns a set switch into vatEntrepreneur from 2000 and drops the setting', () => {
    for (const [stored, expected] of [['true', [{ key: 'vatEntrepreneur', validFrom: '2000-01-01', value: 'true' }]], ['false', []]] as const) {
      const db = new Database(':memory:');
      applyMigrationsUpTo(db, '0010_media_ai_kind_finance_locks_0_3_1.sql');
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('finance.isEntrepreneurOrHasVatId', ?, 't')`).run(stored);
      applyMigration(db, SQUASHED_0_4_0);
      expect(db.prepare(`SELECT key, valid_from AS validFrom, value FROM finance_dated_values`).all()).toEqual(expected);
      expect(db.prepare(`SELECT key FROM settings WHERE key = 'finance.isEntrepreneurOrHasVatId'`).all()).toEqual([]);
      db.close();
    }
  });
});

describe('migration 0011 (0.4.0), aus 0053 (E6a: § 13b nach EU und übrigen Leistungen)', () => {
  it('splits rc13b by the seat of the contact or the country of the counterparty IBAN, and keeps final lines locked', () => {
    const db = new Database(':memory:');
    applyMigrationsUpTo(db, '0010_media_ai_kind_finance_locks_0_3_1.sql');
    // Nur die Spalten, die der Übertrag liest; Konten, Läufe und Nutzer fehlen bewusst.
    db.pragma('foreign_keys = OFF');
    db.exec(`INSERT INTO contacts (id, kind, country, created_at, updated_at) VALUES ('C-IE', 'organization', 'IE', 't', 't'), ('C-GB', 'organization', 'GB', 't', 't'), ('C-DE', 'organization', 'DE', 't', 't');
      INSERT INTO finance_categories (id, key, name, direction, default_tax_code, created_at, updated_at) VALUES ('K1', 'ads', 'Werbung', 'expense', 'rc13b', 't', 't');
      INSERT INTO finance_entries (id, entry_date, text, status, created_by_user_id, created_channel, created_at, updated_at) VALUES ('E1', '2026-05-12', 'x', 'draft', 'U', 'ui', 't', 't');
      INSERT INTO finance_raw_transactions (id, run_id, account_id, booking_date, amount_cents, dedup_key, line_index, created_at, counterparty_iban) VALUES ('R1', 'RUN', 'A', '2026-05-12', -100, 'd', 0, 't', 'NL91ABNA0417164300');
      INSERT INTO finance_money_lines (id, entry_id, position, account_id, amount_cents, raw_transaction_id) VALUES ('M1', 'E1', 0, 'A', -500, 'R1');
      INSERT INTO finance_allocation_lines (id, entry_id, position, category_id, amount_cents, tax_code, contact_id) VALUES
        ('L-IE', 'E1', 0, 'K1', -100, 'rc13b', 'C-IE'), ('L-NL', 'E1', 1, 'K1', -100, 'rc13b', NULL), ('L-GB', 'E1', 2, 'K1', -100, 'rc13b', 'C-GB'), ('L-DE', 'E1', 3, 'K1', -100, 'rc13b', 'C-DE'), ('L-STD', 'E1', 4, 'K1', -100, 'standard', NULL);
      INSERT INTO finance_entries (id, entry_date, text, status, created_by_user_id, created_channel, created_at, updated_at) VALUES ('E2', '2026-05-12', 'y', 'draft', 'U', 'ui', 't', 't');
      INSERT INTO finance_allocation_lines (id, entry_id, position, category_id, amount_cents, tax_code, contact_id) VALUES ('L-GB2', 'E2', 0, 'K1', -100, 'rc13b', 'C-GB'), ('L-DE2', 'E2', 1, 'K1', -100, 'rc13b', 'C-DE');
      UPDATE finance_entries SET status = 'final';
      INSERT INTO finance_import_rules (id, name, category_id, direction, tax_code, contact_id, created_at, created_by_user_id, updated_at) VALUES ('IR1', 'a', 'K1', 'expense', 'rc13b', NULL, 't', 'U', 't'), ('IR2', 'b', 'K1', 'expense', 'rc13b', 'C-GB', 't', 'U', 't');`);
    applyMigration(db, SQUASHED_0_4_0);
    // L-NL: ohne Kontakt, aber die Buchung trägt einen Umsatz mit niederländischer IBAN — gilt für alle Zeilen der Buchung E1.
    expect(Object.fromEntries((db.prepare('SELECT id, tax_code AS code FROM finance_allocation_lines').all() as { id: string; code: string }[]).map((r) => [r.id, r.code]))).toEqual({
      'L-IE': 'rc13bEu', 'L-NL': 'rc13bEu', 'L-GB': 'rc13bEu', 'L-DE': 'rc13bEu', 'L-STD': 'standard', 'L-GB2': 'rc13bOther', 'L-DE2': 'rc13bOther',
    });
    expect(db.prepare('SELECT default_tax_code AS code FROM finance_categories').get()).toEqual({ code: 'rc13bEu' });
    expect(db.prepare('SELECT id, tax_code AS code FROM finance_import_rules ORDER BY id').all()).toEqual([{ id: 'IR1', code: 'rc13bEu' }, { id: 'IR2', code: 'rc13bOther' }]);
    // Die festgeschriebene Zeile: Wechsel innerhalb der § 13b-Kennzeichen an einer Ausgabe geht, alles andere nicht.
    db.prepare(`UPDATE finance_allocation_lines SET tax_code = 'rc13bOther', service_date = '2026-04-30' WHERE id = 'L-IE'`).run();
    expect(() => db.prepare(`UPDATE finance_allocation_lines SET tax_code = 'standard' WHERE id = 'L-IE'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE finance_allocation_lines SET tax_code = 'rc13bEu' WHERE id = 'L-STD'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE finance_allocation_lines SET amount_cents = 1 WHERE id = 'L-IE'`).run()).toThrow(/immutable/);
    db.close();
  });
});

describe('migration 0011 (0.4.0), aus 0054–0056 (E6a: Abgabe je Umsatzsteuer-Zeitraum)', () => {
  it('turns every filed VAT return of a fiscal year into an annual filing without digest, and drops the old table', () => {
    // `finance_vat_returns` entstand erst in 0.4.0 (alte 0041) — keine Produktion hat Zeilen darin. Der Übertrag
    // läuft daher im Zwischenstand vor der alten 0055 an, nicht ab 0.3.2.
    const db = new Database(':memory:');
    applyMigrationsUpTo(db, '0010_media_ai_kind_finance_locks_0_3_1.sql');
    applySquashedPart(db, { until: '0055_finance_vat_filings_transfer.sql' });
    db.exec(`INSERT INTO finance_fiscal_years (id, starts_on, ends_on, designation, created_at, updated_at) VALUES ('01JYEAR2025AAAAAAAAAAAAAAA', '2025-01-01', '2025-12-31', '2025', 't', 't');
      INSERT INTO finance_vat_returns (fiscal_year_id, filed_on, at, by_user_id) VALUES ('01JYEAR2025AAAAAAAAAAAAAAA', '2026-07-20', '2026-07-20T10:00:00.000Z', 'U1');`);
    applySquashedPart(db, { from: '0055_finance_vat_filings_transfer.sql' });
    expect(db.prepare('SELECT id, period, filed_on AS filedOn, amendment, lines_digest AS linesDigest, by_user_id AS byUserId FROM finance_vat_filings').all()).toEqual([
      { id: '01JYEAR2025AAAAAAAAAAAAAAA', period: '2025', filedOn: '2026-07-20', amendment: 0, linesDigest: null, byUserId: 'U1' },
    ]);
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    expect(tables).not.toContain('finance_vat_returns');
    expect(() => db.prepare('DELETE FROM finance_vat_filings').run()).toThrow(/permanent/);
    // Seit der alten 0060 (E6b) bleibt der Tag der Abgabe änderbar; Zeitraum und Berichtigung stehen fest.
    expect(() => db.prepare(`UPDATE finance_vat_filings SET period = '2024'`).run()).toThrow(/permanent/);
    db.close();
  });
});
