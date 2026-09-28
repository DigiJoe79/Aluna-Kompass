-- Fassung 0.2.0: die Entwicklungsmigrationen 0003_module_provisions bis 0040_finance_approval_purpose_reason,
-- unverändert in ihrer Reihenfolge verkettet (nicht neu erzeugt), damit Daten-
-- und Trigger-Umbauten auf Bestandsdaten genauso wirken wie in der alten Reihe.
-- Quelle: 0003_module_provisions.sql
CREATE TABLE `module_provisions_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`message` text NOT NULL,
	`at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE TABLE `module_provisions` (
	`module` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`outcome` text NOT NULL,
	`provisioned_at` text NOT NULL,
	PRIMARY KEY(`module`, `kind`, `key`)
);
--> statement-breakpoint
ALTER TABLE `roles` ADD `origin_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `roles_origin_key_idx` ON `roles` (`origin_key`);
--> statement-breakpoint
-- Quelle: 0004_document_type_owner.sql
ALTER TABLE `document_types` ADD `owner_module` text;--> statement-breakpoint
ALTER TABLE `document_types` ADD `protection_area` text;
--> statement-breakpoint
-- Quelle: 0005_contacts_user_links.sql
CREATE TABLE `contacts_user_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`linked_by_user_id` text NOT NULL,
	`unlinked_at` text,
	`unlinked_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_links_open_user_idx` ON `contacts_user_links` (`user_id`) WHERE "contacts_user_links"."unlinked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_links_open_contact_idx` ON `contacts_user_links` (`contact_id`) WHERE "contacts_user_links"."unlinked_at" is null;
--> statement-breakpoint
-- Quelle: 0006_finance_accounts.sql
CREATE TABLE `finance_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`iban` text,
	`bic` text,
	`bank_name` text,
	`opening_balance_cents` integer,
	`opening_date` text,
	`import_format` text,
	`is_main` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_accounts_main_idx` ON `finance_accounts` (`is_main`) WHERE "finance_accounts"."is_main" = 1;--> statement-breakpoint
CREATE INDEX `finance_accounts_active_idx` ON `finance_accounts` (`is_active`);
--> statement-breakpoint
-- Quelle: 0007_finance_categories.sql
CREATE TABLE `finance_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`direction` text NOT NULL,
	`sphere` text,
	`income_kind` text,
	`cost_function` text,
	`allowance_kind` text DEFAULT 'none' NOT NULL,
	`statement_suffices` integer DEFAULT false NOT NULL,
	`default_tax_code` text DEFAULT 'none' NOT NULL,
	`input_tax_deductible` text DEFAULT 'no' NOT NULL,
	`counts_toward_turnover` integer DEFAULT false NOT NULL,
	`is_asset_sale` integer DEFAULT false NOT NULL,
	`external_account_number` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_categories_key_idx` ON `finance_categories` (`key`);
--> statement-breakpoint
-- Quelle: 0008_finance_purposes.sql
CREATE TABLE `finance_purposes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_id` text,
	`reference_note` text,
	`target_cents` integer,
	`abroad` integer DEFAULT false NOT NULL,
	`carry_forward_cents` integer,
	`carry_forward_date` text,
	`fulfilled_at` text,
	`fulfilled_by_user_id` text,
	`dissolved_at` text,
	`dissolved_by_user_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_purposes_project_idx` ON `finance_purposes` (`project_id`);
--> statement-breakpoint
-- Quelle: 0009_finance_fiscal_years.sql
CREATE TABLE `finance_entry_counters` (
	`fiscal_year_id` text PRIMARY KEY NOT NULL,
	`last` integer NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_fiscal_years` (
	`id` text PRIMARY KEY NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`designation` text NOT NULL,
	`tax_return_filed_on` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_fiscal_years_designation_idx` ON `finance_fiscal_years` (`designation`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_fiscal_years_start_idx` ON `finance_fiscal_years` (`starts_on`);--> statement-breakpoint
CREATE TABLE `finance_period_events` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL,
	`reason` text,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_period_events_year_idx` ON `finance_period_events` (`fiscal_year_id`,`at`);
--> statement-breakpoint
-- Quelle: 0010_finance_dated_values.sql
CREATE TABLE `finance_dated_values` (
	`key` text NOT NULL,
	`valid_from` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text,
	PRIMARY KEY(`key`, `valid_from`)
);

--> statement-breakpoint
-- Quelle: 0011_finance_entries.sql
CREATE TABLE `finance_allocation_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`position` integer NOT NULL,
	`category_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`tax_code` text DEFAULT 'none' NOT NULL,
	`rate_kind` text DEFAULT 'standard' NOT NULL,
	`project_id` text,
	`purpose_id` text,
	`contact_id` text,
	`abroad` integer DEFAULT false NOT NULL,
	`origin_line_id` text,
	`adds_to_assets` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_allocation_lines_entry_idx` ON `finance_allocation_lines` (`entry_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_lines_category_idx` ON `finance_allocation_lines` (`category_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_lines_contact_idx` ON `finance_allocation_lines` (`contact_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_lines_purpose_idx` ON `finance_allocation_lines` (`purpose_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_lines_project_idx` ON `finance_allocation_lines` (`project_id`);--> statement-breakpoint
CREATE TABLE `finance_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text,
	`entry_date` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`fiscal_year_id` text,
	`reviewed_at` text,
	`reviewed_by_user_id` text,
	`finalized_at` text,
	`finalized_by_user_id` text,
	`finalized_channel` text,
	`reverses_entry_id` text,
	`reversed_by_entry_id` text,
	`correction_of_entry_id` text,
	`cash_warning_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_channel` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_entries_number_idx` ON `finance_entries` (`number`);--> statement-breakpoint
CREATE INDEX `finance_entries_date_idx` ON `finance_entries` (`entry_date`);--> statement-breakpoint
CREATE INDEX `finance_entries_status_idx` ON `finance_entries` (`status`);--> statement-breakpoint
CREATE TABLE `finance_money_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`position` integer NOT NULL,
	`account_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`raw_transaction_id` text,
	`raw_released_at` text,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_money_lines_entry_idx` ON `finance_money_lines` (`entry_id`);--> statement-breakpoint
CREATE INDEX `finance_money_lines_account_idx` ON `finance_money_lines` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_money_lines_raw_idx` ON `finance_money_lines` (`raw_transaction_id`) WHERE "finance_money_lines"."raw_released_at" is null and "finance_money_lines"."raw_transaction_id" is not null;
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts).
--
-- Eine festgeschriebene Buchung ist auf Datenbankebene unveränderlich
-- (Finanz-Spec 5.2, abschließende Liste der änderbaren Spalten):
--   Kopf             nur reversed_by_entry_id                  (Storno)
--   Geldzeile        raw_released_at; raw_transaction_id von leer auf einen Wert
--   Zuordnungszeile  contact_id, project_id, purpose_id, abroad  (Zuordnungskorrektur, später Anonymisierung)
CREATE TRIGGER finance_entries_final_no_update BEFORE UPDATE OF id, number, entry_date, text, status, fiscal_year_id, reviewed_at, reviewed_by_user_id, finalized_at, finalized_by_user_id, finalized_channel, reverses_entry_id, correction_of_entry_id, cash_warning_reason, created_by_user_id, created_channel, created_at ON finance_entries
WHEN OLD.status = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_entries_final_no_delete BEFORE DELETE ON finance_entries
WHEN OLD.status = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_money_lines_final_no_update BEFORE UPDATE OF id, entry_id, position, account_id, amount_cents ON finance_money_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_money_lines_final_raw_once BEFORE UPDATE OF raw_transaction_id ON finance_money_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final' AND OLD.raw_transaction_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_money_lines_final_no_delete BEFORE DELETE ON finance_money_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_money_lines_final_no_insert BEFORE INSERT ON finance_money_lines
WHEN (SELECT status FROM finance_entries WHERE id = NEW.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_lines_final_no_update BEFORE UPDATE OF id, entry_id, position, category_id, amount_cents, tax_code, rate_kind, origin_line_id, adds_to_assets ON finance_allocation_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_lines_final_no_delete BEFORE DELETE ON finance_allocation_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_lines_final_no_insert BEFORE INSERT ON finance_allocation_lines
WHEN (SELECT status FROM finance_entries WHERE id = NEW.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
-- Quelle: 0012_finance_entry_documents.sql
CREATE TABLE `finance_entry_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`document_id` text,
	`document_number` text NOT NULL,
	`document_checksum` text,
	`document_deleted_at` text,
	`added_at` text NOT NULL,
	`added_by_user_id` text NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` text,
	`revoke_note` text,
	`replaced_by_link_id` text,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_entry_documents_pair_idx` ON `finance_entry_documents` (`entry_id`,`document_id`);--> statement-breakpoint
CREATE INDEX `finance_entry_documents_document_idx` ON `finance_entry_documents` (`document_id`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Eine Belegverknüpfung ist auf
-- Datenbankebene dauerhaft (Finanz-Spec 5.2): Was sie ansteuert, ändert sich
-- nie — weder im Entwurf noch nach dem Festschreiben; gelöscht wird sie nur,
-- solange die Buchung ein Entwurf ist. Die Dokument-ID darf nur verschwinden
-- (Grabstein, F2c), nie auf ein anderes Dokument zeigen. Ein Widerruf trägt
-- vier Spalten und lässt sich genau einmal setzen.
CREATE TRIGGER finance_entry_documents_no_retarget BEFORE UPDATE OF id, entry_id, document_number, document_checksum, added_at, added_by_user_id ON finance_entry_documents
BEGIN
  SELECT RAISE(ABORT, 'finance voucher link is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_entry_documents_document_only_cleared BEFORE UPDATE OF document_id ON finance_entry_documents
WHEN NEW.document_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'finance voucher link is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_entry_documents_revoke_once BEFORE UPDATE OF revoked_at, revoked_by_user_id, revoke_note, replaced_by_link_id ON finance_entry_documents
WHEN OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'finance voucher link is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_entry_documents_final_no_delete BEFORE DELETE ON finance_entry_documents
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finance voucher link is permanent');
END;
--> statement-breakpoint
-- Quelle: 0013_finance_open_items.sql
CREATE TABLE `finance_open_item_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`money_line_id` text NOT NULL,
	`open_item_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`money_line_id`) REFERENCES `finance_money_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`open_item_id`) REFERENCES `finance_open_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_open_item_settlements_pair_idx` ON `finance_open_item_settlements` (`money_line_id`,`open_item_id`);--> statement-breakpoint
CREATE INDEX `finance_open_item_settlements_item_idx` ON `finance_open_item_settlements` (`open_item_id`);--> statement-breakpoint
CREATE TABLE `finance_open_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`item_date` text NOT NULL,
	`contact_id` text,
	`amount_cents` integer NOT NULL,
	`due_on` text,
	`document_id` text,
	`origin_type` text,
	`origin_id` text,
	`payment_reference` text,
	`line_template` text,
	`cancelled_at` text,
	`cancelled_by_user_id` text,
	`cancel_note` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_open_items_kind_idx` ON `finance_open_items` (`kind`);--> statement-breakpoint
CREATE INDEX `finance_open_items_origin_idx` ON `finance_open_items` (`origin_type`,`origin_id`);--> statement-breakpoint
CREATE INDEX `finance_open_items_contact_idx` ON `finance_open_items` (`contact_id`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Settlements einer festgeschriebenen
-- Buchung sind so fest wie ihre Zeilen (Finanz-Spec 5.3).
CREATE TRIGGER finance_open_item_settlements_final_no_update BEFORE UPDATE ON finance_open_item_settlements
WHEN (SELECT e.status FROM finance_entries e JOIN finance_money_lines m ON m.entry_id = e.id WHERE m.id = OLD.money_line_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_open_item_settlements_final_no_delete BEFORE DELETE ON finance_open_item_settlements
WHEN (SELECT e.status FROM finance_entries e JOIN finance_money_lines m ON m.entry_id = e.id WHERE m.id = OLD.money_line_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_open_item_settlements_final_no_insert BEFORE INSERT ON finance_open_item_settlements
WHEN (SELECT e.status FROM finance_entries e JOIN finance_money_lines m ON m.entry_id = e.id WHERE m.id = NEW.money_line_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
-- Quelle: 0014_finance_allocation_corrections.sql
CREATE TABLE `finance_allocation_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`line_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`state` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`note` text NOT NULL,
	`proof_document_id` text,
	`section_153` integer DEFAULT false NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`requested_at` text NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`rejected_by_user_id` text,
	`rejected_at` text,
	`reject_note` text,
	FOREIGN KEY (`line_id`) REFERENCES `finance_allocation_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_allocation_corrections_line_idx` ON `finance_allocation_corrections` (`line_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_corrections_entry_idx` ON `finance_allocation_corrections` (`entry_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_corrections_state_idx` ON `finance_allocation_corrections` (`state`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Eine Zuordnungskorrektur ist der
-- Fachdatensatz zu E18: nie gelöscht, ihr Antrag (wer, was, vorher/nachher,
-- Notiz) unveränderlich — nur der Zustand und die Freigabe-/Ablehnungsspalten
-- wandern von `pending` zu `applied` oder `rejected`.
CREATE TRIGGER finance_allocation_corrections_no_delete BEFORE DELETE ON finance_allocation_corrections
BEGIN
  SELECT RAISE(ABORT, 'finance correction is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_corrections_request_immutable BEFORE UPDATE OF line_id, entry_id, before, after, note, requested_by_user_id, requested_at ON finance_allocation_corrections
BEGIN
  SELECT RAISE(ABORT, 'finance correction is permanent');
END;
--> statement-breakpoint
-- Quelle: 0015_finance_entry_justifications.sql
CREATE TABLE `finance_entry_justifications` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`by_user_id` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
-- Quelle: 0016_finance_project_settings.sql
CREATE TABLE `finance_project_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`target_cents` integer,
	`default_purpose_id` text,
	`abroad` integer DEFAULT false NOT NULL,
	`publish_donation_status` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`default_purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
-- Quelle: 0017_finance_cash_counts.sql
CREATE TABLE `finance_cash_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`counted_on` text NOT NULL,
	`counted_cents` integer NOT NULL,
	`book_cents` integer NOT NULL,
	`difference_cents` integer NOT NULL,
	`counter_one_contact_id` text NOT NULL,
	`counter_two_contact_id` text NOT NULL,
	`counter_one_name` text NOT NULL,
	`counter_two_name` text NOT NULL,
	`note` text,
	`denominations` text,
	`document_id` text,
	`document_number` text NOT NULL,
	`entry_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_cash_counts_account_idx` ON `finance_cash_counts` (`account_id`,`counted_on`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Eine Kassenzählung ist eine
-- gespeicherte Tatsache (Finanz-Spec 5.5) — auf Datenbankebene dauerhaft.
-- Einzige Ausnahme: Die Dokument-ID darf nur verschwinden (Grabstein beim
-- Löschen des Dokuments, Muster `finance_entry_documents`), nie auf ein
-- anderes Dokument zeigen.
CREATE TRIGGER finance_cash_counts_no_update BEFORE UPDATE OF id, account_id, counted_on, counted_cents, book_cents, difference_cents, counter_one_contact_id, counter_two_contact_id, counter_one_name, counter_two_name, note, denominations, document_number, entry_id, created_by_user_id, created_at ON finance_cash_counts
BEGIN
  SELECT RAISE(ABORT, 'a cash count is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_cash_counts_document_only_cleared BEFORE UPDATE OF document_id ON finance_cash_counts
WHEN NEW.document_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a cash count is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_cash_counts_no_delete BEFORE DELETE ON finance_cash_counts
BEGIN
  SELECT RAISE(ABORT, 'a cash count is a permanent record');
END;
--> statement-breakpoint
-- Quelle: 0018_finance_import.sql
CREATE TABLE `finance_import_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`account_id` text NOT NULL,
	`line` text NOT NULL,
	`matches_raw_transaction_id` text,
	`dedup_key` text NOT NULL,
	`decision` text,
	`decided_at` text,
	`decided_by_user_id` text,
	`raw_transaction_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `finance_import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matches_raw_transaction_id`) REFERENCES `finance_raw_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_transaction_id`) REFERENCES `finance_raw_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_import_candidates_run_idx` ON `finance_import_candidates` (`run_id`);--> statement-breakpoint
CREATE TABLE `finance_import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`format` text NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`file_key` text,
	`period_from` text,
	`period_to` text,
	`opening_cents` integer,
	`closing_cents` integer,
	`count_new` integer,
	`count_known` integer,
	`count_held` integer,
	`count_pending_skipped` integer,
	`gap_from` text,
	`gap_to` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`failed_at` text,
	`failure_code` text,
	`failure_line` integer,
	`discarded_at` text,
	`discarded_by_user_id` text,
	`discard_note` text,
	`created_by_user_id` text NOT NULL,
	`created_channel` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_import_runs_account_idx` ON `finance_import_runs` (`account_id`);--> statement-breakpoint
CREATE TABLE `finance_raw_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`account_id` text NOT NULL,
	`booking_date` text NOT NULL,
	`value_date` text,
	`amount_cents` integer NOT NULL,
	`counterparty_name` text,
	`counterparty_iban` text,
	`purpose` text DEFAULT '' NOT NULL,
	`bank_reference` text,
	`end_to_end_id` text,
	`return_code` text,
	`dedup_key` text NOT NULL,
	`line_index` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `finance_import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_raw_transactions_reference_idx` ON `finance_raw_transactions` (`account_id`,`bank_reference`) WHERE "finance_raw_transactions"."bank_reference" is not null;--> statement-breakpoint
CREATE INDEX `finance_raw_transactions_dedup_idx` ON `finance_raw_transactions` (`account_id`,`dedup_key`);--> statement-breakpoint
CREATE INDEX `finance_raw_transactions_run_idx` ON `finance_raw_transactions` (`run_id`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts, packages/modules/finance/tests/import-schema.test.ts).
--
-- Ein Rohumsatz ist unveränderlich ab dem Einlesen (Finanz-Spec 6.1) und nur
-- löschbar, solange keine festgeschriebene, nicht zurückgenommene Buchung
-- darauf zeigt (finance_money_lines.raw_transaction_id, finance_entries.status
-- = 'final' und reversed_by_entry_id IS NULL).
CREATE TRIGGER finance_raw_transactions_no_update BEFORE UPDATE OF id, run_id, account_id, booking_date, value_date, amount_cents, counterparty_name, counterparty_iban, purpose, bank_reference, end_to_end_id, return_code, dedup_key, line_index, created_at ON finance_raw_transactions
BEGIN
  SELECT RAISE(ABORT, 'a raw transaction is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_raw_transactions_booked_no_delete BEFORE DELETE ON finance_raw_transactions
WHEN EXISTS (
  SELECT 1 FROM finance_money_lines ml
  JOIN finance_entries e ON e.id = ml.entry_id
  WHERE ml.raw_transaction_id = OLD.id AND e.status = 'final' AND e.reversed_by_entry_id IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'a raw transaction booked by a finalized, unreversed entry is a permanent record');
END;
--> statement-breakpoint
-- Ein Importlauf ist eine geschriebene Tatsache (Finanz-Spec 6.1). Identität
-- und Herkunft ändern sich nie; Zähler und Abschlussfelder nur, solange der
-- Lauf noch nicht fertig oder fehlgeschlagen ist; danach nur noch das
-- Verwerfen (discarded_*, je einmal) und die Datei-Referenz auf NULL (je
-- einmal).
CREATE TRIGGER finance_import_runs_identity_immutable BEFORE UPDATE OF id, account_id, format, file_name, file_sha256, started_at, created_by_user_id, created_channel ON finance_import_runs
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_runs_facts_immutable BEFORE UPDATE OF period_from, period_to, opening_cents, closing_cents, count_new, count_known, count_held, count_pending_skipped, gap_from, gap_to, finished_at, failed_at, failure_code, failure_line ON finance_import_runs
WHEN OLD.finished_at IS NOT NULL OR OLD.failed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_runs_file_key_only_cleared BEFORE UPDATE OF file_key ON finance_import_runs
WHEN NOT (NEW.file_key IS NULL AND OLD.file_key IS NOT NULL AND (OLD.finished_at IS NOT NULL OR OLD.failed_at IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_runs_discard_once BEFORE UPDATE OF discarded_at, discarded_by_user_id, discard_note ON finance_import_runs
WHEN OLD.discarded_at IS NOT NULL OR (OLD.finished_at IS NULL AND OLD.failed_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_runs_no_delete BEFORE DELETE ON finance_import_runs
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
--> statement-breakpoint
-- Ein Kandidat wird genau einmal entschieden (Finanz-Spec 6.1, 6.3).
CREATE TRIGGER finance_import_candidates_decide_once BEFORE UPDATE OF decision, decided_at, decided_by_user_id, raw_transaction_id ON finance_import_candidates
WHEN OLD.decision IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a candidate can be decided only once');
END;
--> statement-breakpoint
-- Quelle: 0019_finance_import_profiles.sql
CREATE TABLE `finance_import_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`header_signature` text NOT NULL,
	`builtin_key` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_channel` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `finance_accounts` ADD `import_profile_id` text;--> statement-breakpoint
ALTER TABLE `finance_import_runs` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `finance_import_runs` ADD `profile_name` text;--> statement-breakpoint
UPDATE `finance_accounts` SET `import_format` = NULL WHERE `import_format` = 'csv' AND `import_profile_id` IS NULL;
--> statement-breakpoint
CREATE TRIGGER finance_import_profiles_no_update BEFORE UPDATE ON finance_import_profiles
BEGIN
  SELECT RAISE(ABORT, 'a csv import format is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_profiles_no_delete_used BEFORE DELETE ON finance_import_profiles
WHEN EXISTS (SELECT 1 FROM finance_accounts WHERE import_profile_id = OLD.id) OR EXISTS (SELECT 1 FROM finance_import_runs WHERE profile_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'a csv import format in use cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER finance_accounts_profile_matches_format_insert BEFORE INSERT ON finance_accounts
WHEN (COALESCE(NEW.import_format, '') = 'csv') <> (NEW.import_profile_id IS NOT NULL)
  OR (NEW.import_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM finance_import_profiles WHERE id = NEW.import_profile_id))
BEGIN
  SELECT RAISE(ABORT, 'import format and csv import format must match');
END;
--> statement-breakpoint
CREATE TRIGGER finance_accounts_profile_matches_format_update BEFORE UPDATE OF import_format, import_profile_id ON finance_accounts
WHEN (COALESCE(NEW.import_format, '') = 'csv') <> (NEW.import_profile_id IS NOT NULL)
  OR (NEW.import_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM finance_import_profiles WHERE id = NEW.import_profile_id))
BEGIN
  SELECT RAISE(ABORT, 'import format and csv import format must match');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_runs_profile_immutable BEFORE UPDATE OF profile_id, profile_name ON finance_import_runs
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;

--> statement-breakpoint
-- Quelle: 0020_finance_import_rules.sql
CREATE TABLE `finance_contact_bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`iban` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_contact_bank_accounts_pair_idx` ON `finance_contact_bank_accounts` (`contact_id`,`iban`);--> statement-breakpoint
CREATE INDEX `finance_contact_bank_accounts_iban_idx` ON `finance_contact_bank_accounts` (`iban`);--> statement-breakpoint
CREATE TABLE `finance_import_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`account_id` text,
	`direction` text,
	`counterparty_iban` text,
	`text_contains` text,
	`amount_min_cents` integer,
	`amount_max_cents` integer,
	`category_id` text NOT NULL,
	`project_id` text,
	`purpose_id` text,
	`contact_id` text,
	`tax_code` text,
	`entry_text` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_import_rules_order_idx` ON `finance_import_rules` (`sort_order`);--> statement-breakpoint
CREATE TRIGGER finance_import_rules_needs_condition_insert BEFORE INSERT ON finance_import_rules
WHEN NEW.account_id IS NULL AND NEW.direction IS NULL AND NEW.counterparty_iban IS NULL AND NEW.text_contains IS NULL AND NEW.amount_min_cents IS NULL AND NEW.amount_max_cents IS NULL
BEGIN
  SELECT RAISE(ABORT, 'an import rule needs at least one condition');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_rules_needs_condition_update BEFORE UPDATE ON finance_import_rules
WHEN NEW.account_id IS NULL AND NEW.direction IS NULL AND NEW.counterparty_iban IS NULL AND NEW.text_contains IS NULL AND NEW.amount_min_cents IS NULL AND NEW.amount_max_cents IS NULL
BEGIN
  SELECT RAISE(ABORT, 'an import rule needs at least one condition');
END;

--> statement-breakpoint
-- Quelle: 0021_finance_import_runs_balance_once.sql
-- Von Hand angefügt (Plan „finanzen-n2-kleinkram“ Task 2): „Kontostand
-- nachtragen“ — ein CSV-Lauf ohne Kontostand bekommt ihn genau einmal
-- nachträglich (Spec 6.1 „sonst fragt der Lauf optional ‚Kontostand laut
-- Bank am …?‘“). `finance_import_runs_facts_immutable` (0018) sperrte
-- `opening_cents`/`closing_cents` zusammen mit den übrigen Abschlussfeldern,
-- sobald der Lauf fertig oder fehlgeschlagen war — dafür ersetzt, ohne die
-- zwei Saldo-Spalten.
DROP TRIGGER finance_import_runs_facts_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_import_runs_facts_immutable BEFORE UPDATE OF period_from, period_to, count_new, count_known, count_held, count_pending_skipped, gap_from, gap_to, finished_at, failed_at, failure_code, failure_line ON finance_import_runs
WHEN OLD.finished_at IS NOT NULL OR OLD.failed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
--> statement-breakpoint
-- Ein Kontostand wird genau einmal gesetzt: entweder beim Import selbst
-- (`writeRun` schreibt opening_cents/closing_cents und finished_at in
-- derselben UPDATE-Anweisung — zu diesem Zeitpunkt ist OLD.finished_at noch
-- NULL, der Fall bleibt also erlaubt) oder danach genau einmal über
-- `setRunClosingBalance`, solange der Lauf fertig, nicht verworfen und ohne
-- Kontostand ist. Ein zweites Nachtragen (Tippfehler) und ein Nachtragen an
-- einem verworfenen Lauf sind gesperrt.
CREATE TRIGGER finance_import_runs_balance_once BEFORE UPDATE OF opening_cents, closing_cents ON finance_import_runs
WHEN OLD.finished_at IS NOT NULL AND (OLD.discarded_at IS NOT NULL OR OLD.closing_cents IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'a statement balance is set once');
END;

--> statement-breakpoint
-- Quelle: 0022_finance_donations.sql
CREATE TABLE `finance_confirmation_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`confirmation_id` text NOT NULL,
	`line_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`released_at` text,
	FOREIGN KEY (`confirmation_id`) REFERENCES `finance_confirmations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`line_id`) REFERENCES `finance_allocation_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_confirmation_lines_line_idx` ON `finance_confirmation_lines` (`line_id`) WHERE "finance_confirmation_lines"."released_at" is null;--> statement-breakpoint
CREATE INDEX `finance_confirmation_lines_confirmation_idx` ON `finance_confirmation_lines` (`confirmation_id`);--> statement-breakpoint
CREATE INDEX `finance_confirmation_lines_all_line_idx` ON `finance_confirmation_lines` (`line_id`);--> statement-breakpoint
CREATE TABLE `finance_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`contact_id` text NOT NULL,
	`notice_id` text NOT NULL,
	`document_id` text NOT NULL,
	`document_number` text NOT NULL,
	`issued_on` text NOT NULL,
	`issued_by_user_id` text NOT NULL,
	`issued_channel` text NOT NULL,
	`machine` integer DEFAULT false NOT NULL,
	`signer_id` text,
	`facsimile_checksum` text,
	`expense_waiver` integer DEFAULT false NOT NULL,
	`total_cents` integer NOT NULL,
	`period_from` text,
	`period_to` text,
	`pre_notice_reason` text,
	`signed_document_id` text,
	`sent_at` text,
	`sent_via` text,
	`voided_at` text,
	`voided_by_user_id` text,
	`void_note` text,
	`sent_before_void` integer,
	`original_returned_on` text,
	`tax_office_informed_on` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`notice_id`) REFERENCES `finance_notices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signer_id`) REFERENCES `finance_signers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_confirmations_contact_idx` ON `finance_confirmations` (`contact_id`);--> statement-breakpoint
CREATE INDEX `finance_confirmations_notice_idx` ON `finance_confirmations` (`notice_id`);--> statement-breakpoint
CREATE INDEX `finance_confirmations_document_idx` ON `finance_confirmations` (`document_id`);--> statement-breakpoint
CREATE INDEX `finance_confirmations_issued_idx` ON `finance_confirmations` (`issued_on`);--> statement-breakpoint
CREATE TABLE `finance_in_kind_details` (
	`line_id` text PRIMARY KEY NOT NULL,
	`item` text NOT NULL,
	`condition` text NOT NULL,
	`valuation` text NOT NULL,
	`origin` text NOT NULL,
	`withdrawal_value_cents` integer,
	`vat_cents` integer,
	`proof_document_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `finance_allocation_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`tax_office` text NOT NULL,
	`tax_number` text NOT NULL,
	`notice_date` text NOT NULL,
	`assessment_period` text,
	`purposes_text` text NOT NULL,
	`document_id` text,
	`superseded_on` text,
	`superseded_document_id` text,
	`voided_at` text,
	`voided_by_user_id` text,
	`void_note` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_notices_date_idx` ON `finance_notices` (`notice_date`);--> statement-breakpoint
CREATE TABLE `finance_signers` (
	`id` text PRIMARY KEY NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`signer_name` text NOT NULL,
	`facsimile_key` text,
	`facsimile_checksum` text,
	`notified_on` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_signers_valid_from_idx` ON `finance_signers` (`valid_from`);--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Spenden (F6a):
--   Bescheid         nie gelöscht; „aufgehoben oder ersetzt am“ und „irrtümlich erfasst“ je einmal
--   Unterzeichner    nie gelöscht (ein Amtsende ist valid_to)
--   Bestätigung      nie gelöscht; nach dem Ausstellen nur Versand, unterschriebene Fassung
--                    (leer → Wert), Rücknahme mit Rückholspur (einmal)
--   Bestätigungszeile nie gelöscht; nur released_at, leer → Wert
-- Keine Fremdschlüssel auf Kontakte und Dokumente: die gehören anderen Modulen.
CREATE TRIGGER finance_notices_no_delete BEFORE DELETE ON finance_notices
BEGIN
  SELECT RAISE(ABORT, 'a finance notice is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_notices_supersede_once BEFORE UPDATE OF superseded_on, superseded_document_id ON finance_notices
WHEN OLD.superseded_on IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance notice is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_notices_void_once BEFORE UPDATE OF voided_at, voided_by_user_id, void_note ON finance_notices
WHEN OLD.voided_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance notice is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_signers_no_delete BEFORE DELETE ON finance_signers
BEGIN
  SELECT RAISE(ABORT, 'a finance signer is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_no_delete BEFORE DELETE ON finance_confirmations
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_immutable BEFORE UPDATE OF id, kind, contact_id, notice_id, document_id, document_number, issued_on, issued_by_user_id, issued_channel, machine, signer_id, facsimile_checksum, expense_waiver, total_cents, period_from, period_to, pre_notice_reason, created_at ON finance_confirmations
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_void_once BEFORE UPDATE OF voided_at, voided_by_user_id, void_note, sent_before_void ON finance_confirmations
WHEN OLD.voided_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_trail_once BEFORE UPDATE OF original_returned_on, tax_office_informed_on ON finance_confirmations
WHEN (OLD.original_returned_on IS NOT NULL AND NEW.original_returned_on IS NOT OLD.original_returned_on)
  OR (OLD.tax_office_informed_on IS NOT NULL AND NEW.tax_office_informed_on IS NOT OLD.tax_office_informed_on)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_signed_once BEFORE UPDATE OF signed_document_id ON finance_confirmations
WHEN OLD.signed_document_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_lines_no_delete BEFORE DELETE ON finance_confirmation_lines
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation line is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_lines_release_once BEFORE UPDATE ON finance_confirmation_lines
WHEN NEW.id IS NOT OLD.id OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.line_id IS NOT OLD.line_id OR NEW.amount_cents IS NOT OLD.amount_cents OR OLD.released_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation line is permanent');
END;

--> statement-breakpoint
-- Quelle: 0023_finance_confirmation_runs.sql
CREATE TABLE `finance_confirmation_run_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`in_kind_line_id` text,
	`line_ids` text NOT NULL,
	`total_cents` integer NOT NULL,
	`needs_signature` integer NOT NULL,
	`state` text NOT NULL,
	`confirmation_id` text,
	`error_code` text,
	`done_at` text,
	`sort_key` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `finance_confirmation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_confirmation_run_items_key_idx` ON `finance_confirmation_run_items` (`run_id`,`contact_id`,`kind`,`in_kind_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_confirmation_run_items_collective_idx` ON `finance_confirmation_run_items` (`run_id`,`contact_id`,`kind`) WHERE "finance_confirmation_run_items"."in_kind_line_id" is null;--> statement-breakpoint
CREATE TABLE `finance_confirmation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`min_cents` integer NOT NULL,
	`excluded_contact_ids` text NOT NULL,
	`follow_up_of_run_id` text,
	`started_on` text NOT NULL,
	`started_at` text NOT NULL,
	`started_by_user_id` text NOT NULL,
	`started_channel` text NOT NULL,
	`finished_at` text,
	`dispatched_at` text,
	`dispatched_via` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`follow_up_of_run_id`) REFERENCES `finance_confirmation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Serienlauf (F6b):
--   Lauf    nie gelöscht; Parameter und Start unveränderlich; finished_at,
--           dispatched_at, dispatched_via je einmal von leer auf Wert
--   Posten  nie gelöscht; der Schnappschuss unveränderlich; state,
--           confirmation_id, error_code, done_at verlassen 'pending' einmal
-- Keine Fremdschlüssel auf Kontakte und Bestätigungen am Posten: Kontakte gehören
-- einem anderen Modul, die Bestätigung kommt erst mit dem Ausgang.
CREATE TRIGGER finance_confirmation_runs_no_delete BEFORE DELETE ON finance_confirmation_runs
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_runs_immutable BEFORE UPDATE ON finance_confirmation_runs
WHEN NEW.id IS NOT OLD.id OR NEW.year IS NOT OLD.year OR NEW.min_cents IS NOT OLD.min_cents OR NEW.excluded_contact_ids IS NOT OLD.excluded_contact_ids
  OR NEW.follow_up_of_run_id IS NOT OLD.follow_up_of_run_id OR NEW.started_on IS NOT OLD.started_on OR NEW.started_at IS NOT OLD.started_at
  OR NEW.started_by_user_id IS NOT OLD.started_by_user_id OR NEW.started_channel IS NOT OLD.started_channel OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at)
  OR (OLD.dispatched_via IS NOT NULL AND NEW.dispatched_via IS NOT OLD.dispatched_via)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_run_items_no_delete BEFORE DELETE ON finance_confirmation_run_items
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run item is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_run_items_done_once BEFORE UPDATE ON finance_confirmation_run_items
WHEN NEW.id IS NOT OLD.id OR NEW.run_id IS NOT OLD.run_id OR NEW.contact_id IS NOT OLD.contact_id OR NEW.kind IS NOT OLD.kind
  OR NEW.in_kind_line_id IS NOT OLD.in_kind_line_id OR NEW.line_ids IS NOT OLD.line_ids OR NEW.total_cents IS NOT OLD.total_cents
  OR NEW.needs_signature IS NOT OLD.needs_signature OR NEW.sort_key IS NOT OLD.sort_key
  OR (OLD.state <> 'pending' AND (NEW.state IS NOT OLD.state OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.error_code IS NOT OLD.error_code OR NEW.done_at IS NOT OLD.done_at))
  OR (OLD.confirmation_id IS NOT NULL AND NEW.confirmation_id IS NOT OLD.confirmation_id)
  OR (OLD.error_code IS NOT NULL AND NEW.error_code IS NOT OLD.error_code)
  OR (OLD.done_at IS NOT NULL AND NEW.done_at IS NOT OLD.done_at)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run item is permanent');
END;

--> statement-breakpoint
-- Quelle: 0024_finance_confirmation_runs_pre_notice.sql
ALTER TABLE `finance_confirmation_runs` ADD `pre_notice_reason` text;--> statement-breakpoint
-- Von Hand angefügt (Wächter: tests/migrations.test.ts): Die Begründung vor dem
-- ältesten Bescheid gehört zu den Parametern des Starts und bleibt unveränderlich.
DROP TRIGGER finance_confirmation_runs_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_runs_immutable BEFORE UPDATE ON finance_confirmation_runs
WHEN NEW.id IS NOT OLD.id OR NEW.year IS NOT OLD.year OR NEW.min_cents IS NOT OLD.min_cents OR NEW.excluded_contact_ids IS NOT OLD.excluded_contact_ids
  OR NEW.follow_up_of_run_id IS NOT OLD.follow_up_of_run_id OR NEW.started_on IS NOT OLD.started_on OR NEW.started_at IS NOT OLD.started_at
  OR NEW.started_by_user_id IS NOT OLD.started_by_user_id OR NEW.started_channel IS NOT OLD.started_channel OR NEW.created_at IS NOT OLD.created_at
  OR NEW.pre_notice_reason IS NOT OLD.pre_notice_reason
  OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at)
  OR (OLD.dispatched_via IS NOT NULL AND NEW.dispatched_via IS NOT OLD.dispatched_via)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run is permanent');
END;

--> statement-breakpoint
-- Quelle: 0025_finance_notices_exempt_from.sql
-- Von db:generate kam `ALTER TABLE finance_notices ADD exempt_from text NOT NULL` —
-- SQLite lehnt eine NOT-NULL-Spalte ohne Vorgabe ab. Ein Neuaufbau der Tabelle
-- scheitert auf gefüllten Datenbanken: Der Migrator läuft in einer Transaktion,
-- `PRAGMA foreign_keys = OFF` ist dort wirkungslos, und das DROP TABLE verletzt
-- die Verweise aus finance_confirmations. Darum von Hand (Wächter:
-- tests/migrations.test.ts): die Spalte mit leerer Vorgabe nur in der Datenbank,
-- der Dienst verlangt den Wert immer. „Steuerbefreiung ab“ (BMF 07.11.2013
-- Nr. 14). Auf Test und Prod gibt es keine Bescheide; Entwicklungsdaten bekommen
-- das Bescheiddatum als Beginn (strenger als nötig, nie zu lax). Die Trigger aus
-- 0022 bleiben, weil die Tabelle bleibt.
ALTER TABLE `finance_notices` ADD `exempt_from` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `finance_notices` SET `exempt_from` = `notice_date`;--> statement-breakpoint
-- Von Hand (Wächter: tests/migrations.test.ts): Die Pflichtbegründung vor dem
-- ältesten Bescheid entfällt (BMF 07.11.2013 Nr. 14: solche Bestätigungen sind
-- unrichtig). Die Trigger nennen die Spalte — erst sie, dann die Spalte, dann
-- die Trigger neu.
DROP TRIGGER finance_confirmations_immutable;--> statement-breakpoint
ALTER TABLE `finance_confirmations` DROP COLUMN `pre_notice_reason`;--> statement-breakpoint
CREATE TRIGGER finance_confirmations_immutable BEFORE UPDATE OF id, kind, contact_id, notice_id, document_id, document_number, issued_on, issued_by_user_id, issued_channel, machine, signer_id, facsimile_checksum, expense_waiver, total_cents, period_from, period_to, created_at ON finance_confirmations
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
DROP TRIGGER finance_confirmation_runs_immutable;--> statement-breakpoint
ALTER TABLE `finance_confirmation_runs` DROP COLUMN `pre_notice_reason`;--> statement-breakpoint
CREATE TRIGGER finance_confirmation_runs_immutable BEFORE UPDATE ON finance_confirmation_runs
WHEN NEW.id IS NOT OLD.id OR NEW.year IS NOT OLD.year OR NEW.min_cents IS NOT OLD.min_cents OR NEW.excluded_contact_ids IS NOT OLD.excluded_contact_ids
  OR NEW.follow_up_of_run_id IS NOT OLD.follow_up_of_run_id OR NEW.started_on IS NOT OLD.started_on OR NEW.started_at IS NOT OLD.started_at
  OR NEW.started_by_user_id IS NOT OLD.started_by_user_id OR NEW.started_channel IS NOT OLD.started_channel OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at)
  OR (OLD.dispatched_via IS NOT NULL AND NEW.dispatched_via IS NOT OLD.dispatched_via)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run is permanent');
END;

--> statement-breakpoint
-- Quelle: 0026_finance_expenses.sql
CREATE TABLE `finance_contact_waiver_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`basis_text` text NOT NULL,
	`agreed_on` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_contact_waiver_terms_contact_idx` ON `finance_contact_waiver_terms` (`contact_id`);--> statement-breakpoint
CREATE TABLE `finance_expense_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text,
	`contact_id` text NOT NULL,
	`submitted_by_user_id` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`iban` text,
	`waiver` integer DEFAULT false NOT NULL,
	`recurring` integer DEFAULT false NOT NULL,
	`waiver_basis_text` text,
	`waiver_agreed_on` text,
	`waiver_declared_on` text,
	`waiver_declaration_document_id` text,
	`waiver_signed_document_id` text,
	`claim_agreed_confirmed` integer DEFAULT false NOT NULL,
	`waiver_late_reason` text,
	`waiver_free_funds_cents` integer,
	`submitted_at` text,
	`approved_at` text,
	`approved_by_user_id` text,
	`rejected_at` text,
	`rejected_by_user_id` text,
	`reject_note` text,
	`open_item_id` text,
	`entry_id` text,
	`copied_from_claim_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`open_item_id`) REFERENCES `finance_open_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`copied_from_claim_id`) REFERENCES `finance_expense_claims`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_expense_claims_number_idx` ON `finance_expense_claims` (`number`);--> statement-breakpoint
CREATE INDEX `finance_expense_claims_contact_idx` ON `finance_expense_claims` (`contact_id`);--> statement-breakpoint
CREATE INDEX `finance_expense_claims_state_idx` ON `finance_expense_claims` (`state`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `finance_expense_counters` (
	`year` integer PRIMARY KEY NOT NULL,
	`last` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_expense_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`kind` text NOT NULL,
	`position_date` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`project_id` text,
	`document_id` text,
	`document_number` text,
	`trip_from` text,
	`trip_to` text,
	`trip_reason` text,
	`trip_km` integer,
	`trip_rate_cents_per_km` integer,
	`category_id` text,
	`purpose_id` text,
	FOREIGN KEY (`claim_id`) REFERENCES `finance_expense_claims`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_expense_positions_claim_idx` ON `finance_expense_positions` (`claim_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `finance_expense_positions_project_idx` ON `finance_expense_positions` (`project_id`);--> statement-breakpoint
CREATE INDEX `finance_expense_positions_document_idx` ON `finance_expense_positions` (`document_id`);--> statement-breakpoint
-- Von Hand angefügt (F8a Task 1): Ein Antrag ist ab dem Einreichen Rechenschaft — gelöscht wird nur ein Entwurf.
CREATE TRIGGER finance_expense_claims_no_delete_submitted BEFORE DELETE ON finance_expense_claims
WHEN OLD.state <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a submitted expense claim is permanent');
END;
--> statement-breakpoint
-- Ein Entwurf verlässt den Entwurf nur durch das Einreichen.
CREATE TRIGGER finance_expense_claims_draft_only_submits BEFORE UPDATE OF state ON finance_expense_claims
WHEN OLD.state = 'draft' AND NEW.state NOT IN ('draft', 'submitted')
BEGIN
  SELECT RAISE(ABORT, 'a draft expense claim moves only to submitted');
END;
--> statement-breakpoint
-- Nach dem Einreichen: was eingereicht wurde, bleibt; `state` verlässt `submitted` genau einmal, die Freigabefelder
-- ändern sich nur bis dahin. Danach nur noch die unterschriebene Verzichtserklärung (einmal) und das Leeren einer
-- Dokument-ID, wenn das Dokument nach seiner Frist gelöscht wird (Grabstein).
CREATE TRIGGER finance_expense_claims_submitted_immutable BEFORE UPDATE ON finance_expense_claims
WHEN OLD.state <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.number IS NOT OLD.number OR NEW.contact_id IS NOT OLD.contact_id OR NEW.submitted_by_user_id IS NOT OLD.submitted_by_user_id
  OR NEW.iban IS NOT OLD.iban OR NEW.waiver IS NOT OLD.waiver OR NEW.recurring IS NOT OLD.recurring OR NEW.waiver_basis_text IS NOT OLD.waiver_basis_text
  OR NEW.waiver_agreed_on IS NOT OLD.waiver_agreed_on OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.copied_from_claim_id IS NOT OLD.copied_from_claim_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
    OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.reject_note IS NOT OLD.reject_note
    OR NEW.open_item_id IS NOT OLD.open_item_id OR NEW.entry_id IS NOT OLD.entry_id OR NEW.claim_agreed_confirmed IS NOT OLD.claim_agreed_confirmed
    OR NEW.waiver_late_reason IS NOT OLD.waiver_late_reason OR NEW.waiver_free_funds_cents IS NOT OLD.waiver_free_funds_cents
    OR NEW.waiver_declared_on IS NOT OLD.waiver_declared_on
    OR (NEW.waiver_declaration_document_id IS NOT OLD.waiver_declaration_document_id AND NEW.waiver_declaration_document_id IS NOT NULL)
  ))
  OR (OLD.waiver_signed_document_id IS NOT NULL AND NEW.waiver_signed_document_id IS NOT NULL AND NEW.waiver_signed_document_id IS NOT OLD.waiver_signed_document_id)
)
BEGIN
  SELECT RAISE(ABORT, 'a submitted expense claim is permanent');
END;
--> statement-breakpoint
-- Positionen: nach dem Einreichen nur Kategorie und Zweck, solange der Antrag eingereicht ist; das Dokument höchstens geleert.
CREATE TRIGGER finance_expense_positions_immutable_after_submit BEFORE UPDATE ON finance_expense_positions
WHEN (SELECT state FROM finance_expense_claims WHERE id = OLD.claim_id) <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.claim_id IS NOT OLD.claim_id OR NEW.sort_order IS NOT OLD.sort_order OR NEW.kind IS NOT OLD.kind
  OR NEW.position_date IS NOT OLD.position_date OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.purpose IS NOT OLD.purpose OR NEW.project_id IS NOT OLD.project_id
  OR NEW.document_number IS NOT OLD.document_number OR NEW.trip_from IS NOT OLD.trip_from OR NEW.trip_to IS NOT OLD.trip_to OR NEW.trip_reason IS NOT OLD.trip_reason
  OR NEW.trip_km IS NOT OLD.trip_km OR NEW.trip_rate_cents_per_km IS NOT OLD.trip_rate_cents_per_km
  OR (NEW.document_id IS NOT OLD.document_id AND NEW.document_id IS NOT NULL)
  OR ((SELECT state FROM finance_expense_claims WHERE id = OLD.claim_id) <> 'submitted' AND (NEW.category_id IS NOT OLD.category_id OR NEW.purpose_id IS NOT OLD.purpose_id))
)
BEGIN
  SELECT RAISE(ABORT, 'a position of a submitted expense claim is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_expense_positions_no_insert_after_submit BEFORE INSERT ON finance_expense_positions
WHEN (SELECT state FROM finance_expense_claims WHERE id = NEW.claim_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a submitted expense claim is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_expense_positions_no_delete_after_submit BEFORE DELETE ON finance_expense_positions
WHEN (SELECT state FROM finance_expense_claims WHERE id = OLD.claim_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a position of a submitted expense claim is permanent');
END;

--> statement-breakpoint
-- Quelle: 0027_finance_notices_purposes_accusative.sql
ALTER TABLE `finance_notices` ADD `purposes_text_accusative` text;
--> statement-breakpoint
-- Quelle: 0028_finance_import_runs_warnings.sql
ALTER TABLE `finance_import_runs` ADD `warnings` text;
--> statement-breakpoint
-- Quelle: 0029_finance_entries_reviewed_channel.sql
ALTER TABLE `finance_entries` ADD `reviewed_channel` text;--> statement-breakpoint
-- Von Hand (Befund 18, Wächter: tests/entry-immutability.test.ts): die neue
-- Spalte gehört zum Kopf der Buchung und ist deshalb im selben Umfang
-- geschützt wie `reviewed_at`/`reviewed_by_user_id` — erst die Spalte, dann
-- der Trigger neu, wie in 0025.
DROP TRIGGER finance_entries_final_no_update;--> statement-breakpoint
CREATE TRIGGER finance_entries_final_no_update BEFORE UPDATE OF id, number, entry_date, text, status, fiscal_year_id, reviewed_at, reviewed_by_user_id, reviewed_channel, finalized_at, finalized_by_user_id, finalized_channel, reverses_entry_id, correction_of_entry_id, cash_warning_reason, created_by_user_id, created_channel, created_at ON finance_entries
WHEN OLD.status = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;

--> statement-breakpoint
-- Quelle: 0030_finance_partners.sql
CREATE TABLE `finance_partner_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`kind` text NOT NULL,
	`document_id` text,
	`foreign_language` integer DEFAULT false NOT NULL,
	`explanation_de` text,
	`covered_cents` integer,
	`added_by_user_id` text NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `finance_partner_payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_partner_evidence_payment_idx` ON `finance_partner_evidence` (`payment_id`);--> statement-breakpoint
CREATE TABLE `finance_partner_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`kind` text NOT NULL,
	`notice_date` text NOT NULL,
	`received_on` text NOT NULL,
	`document_id` text,
	`superseded_on` text,
	`voided_at` text,
	`voided_by_user_id` text,
	`void_note` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `finance_partner_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_partner_notices_partner_idx` ON `finance_partner_notices` (`partner_id`,`notice_date`);--> statement-breakpoint
CREATE TABLE `finance_partner_paid_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`paid_line_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `finance_partner_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_line_id`) REFERENCES `finance_allocation_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_partner_paid_lines_paid_line_idx` ON `finance_partner_paid_lines` (`paid_line_id`);--> statement-breakpoint
CREATE INDEX `finance_partner_paid_lines_payment_idx` ON `finance_partner_paid_lines` (`payment_id`);--> statement-breakpoint
CREATE TABLE `finance_partner_payment_counters` (
	`year` integer PRIMARY KEY NOT NULL,
	`last` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_partner_payment_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer,
	`category_id` text,
	`purpose_id` text,
	`project_id` text,
	`goods_line_id` text,
	`note` text,
	FOREIGN KEY (`payment_id`) REFERENCES `finance_partner_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goods_line_id`) REFERENCES `finance_allocation_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_partner_payment_positions_payment_idx` ON `finance_partner_payment_positions` (`payment_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `finance_partner_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text,
	`partner_id` text NOT NULL,
	`basis` text NOT NULL,
	`basis_overridden` integer DEFAULT false NOT NULL,
	`basis_override_reason` text,
	`purpose_text` text DEFAULT '' NOT NULL,
	`agreement_document_id` text,
	`proof_due_on` text,
	`state` text DEFAULT 'draft' NOT NULL,
	`retroactive` integer DEFAULT false NOT NULL,
	`submitted_at` text,
	`approved_by_user_id` text,
	`approved_at` text,
	`approved_channel` text,
	`open_item_id` text,
	`acknowledged_by_user_id` text,
	`acknowledged_at` text,
	`acknowledged_channel` text,
	`notice_reason` text,
	`overdue_reason` text,
	`rejected_by_user_id` text,
	`rejected_at` text,
	`reject_note` text,
	`copied_from_payment_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `finance_partner_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`open_item_id`) REFERENCES `finance_open_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`copied_from_payment_id`) REFERENCES `finance_partner_payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_partner_payments_number_idx` ON `finance_partner_payments` (`number`);--> statement-breakpoint
CREATE INDEX `finance_partner_payments_partner_idx` ON `finance_partner_payments` (`partner_id`);--> statement-breakpoint
CREATE INDEX `finance_partner_payments_state_idx` ON `finance_partner_payments` (`state`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `finance_partner_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`status` text NOT NULL,
	`usual_basis` text,
	`usual_proof_days` integer DEFAULT 90 NOT NULL,
	`register_document_id` text,
	`agreement_document_id` text,
	`note` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_partner_profiles_contact_idx` ON `finance_partner_profiles` (`contact_id`);--> statement-breakpoint
-- Von Hand angefügt (F7 Task 1, Muster 0026): Ein Vorgang ist ab dem Einreichen Rechenschaft — gelöscht wird nur ein Entwurf.
CREATE TRIGGER finance_partner_payments_no_delete_submitted BEFORE DELETE ON finance_partner_payments
WHEN OLD.state <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a submitted partner payment is permanent');
END;
--> statement-breakpoint
-- Ein Entwurf verlässt den Entwurf nur durch das Einreichen.
CREATE TRIGGER finance_partner_payments_draft_only_submits BEFORE UPDATE OF state ON finance_partner_payments
WHEN OLD.state = 'draft' AND NEW.state NOT IN ('draft', 'submitted')
BEGIN
  SELECT RAISE(ABORT, 'a draft partner payment moves only to submitted');
END;
--> statement-breakpoint
-- Nach dem Einreichen bleibt, was eingereicht wurde; `state` verlässt `submitted` genau einmal (Freigeben oder Ablehnen).
-- Danach nur noch das Anerkennen (einmal, nur aus `approved`) und die Begründungen der Warnungen (einmal, solange `submitted`).
CREATE TRIGGER finance_partner_payments_submitted_immutable BEFORE UPDATE ON finance_partner_payments
WHEN OLD.state <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.partner_id IS NOT OLD.partner_id OR NEW.basis IS NOT OLD.basis OR NEW.basis_overridden IS NOT OLD.basis_overridden
  OR NEW.basis_override_reason IS NOT OLD.basis_override_reason OR NEW.purpose_text IS NOT OLD.purpose_text OR NEW.agreement_document_id IS NOT OLD.agreement_document_id
  OR NEW.retroactive IS NOT OLD.retroactive OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.copied_from_payment_id IS NOT OLD.copied_from_payment_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.number IS NOT OLD.number OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
    OR NEW.approved_channel IS NOT OLD.approved_channel OR NEW.open_item_id IS NOT OLD.open_item_id OR NEW.proof_due_on IS NOT OLD.proof_due_on
    OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.reject_note IS NOT OLD.reject_note
    OR (NEW.notice_reason IS NOT OLD.notice_reason AND OLD.notice_reason IS NOT NULL)
    OR (NEW.overdue_reason IS NOT OLD.overdue_reason AND OLD.overdue_reason IS NOT NULL)
  ))
  OR (OLD.state <> 'approved' AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
  OR (OLD.acknowledged_at IS NOT NULL AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
)
BEGIN
  SELECT RAISE(ABORT, 'a submitted partner payment is permanent');
END;
--> statement-breakpoint
-- Positionen: nach dem Einreichen weder Einfügen noch Ändern noch Löschen (Annahme 4) — anders als bei Auslagen wird hier nichts nachträglich zugeordnet.
CREATE TRIGGER finance_partner_payment_positions_no_insert_after_submit BEFORE INSERT ON finance_partner_payment_positions
WHEN (SELECT state FROM finance_partner_payments WHERE id = NEW.payment_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a submitted partner payment is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_partner_payment_positions_no_update_after_submit BEFORE UPDATE ON finance_partner_payment_positions
WHEN (SELECT state FROM finance_partner_payments WHERE id = OLD.payment_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a position of a submitted partner payment is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_partner_payment_positions_no_delete_after_submit BEFORE DELETE ON finance_partner_payment_positions
WHEN (SELECT state FROM finance_partner_payments WHERE id = OLD.payment_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a position of a submitted partner payment is permanent');
END;
--> statement-breakpoint
-- Paid-Lines: im Entwurf gewählt, danach unveränderlich (Annahme 4).
CREATE TRIGGER finance_partner_paid_lines_no_insert_after_submit BEFORE INSERT ON finance_partner_paid_lines
WHEN (SELECT state FROM finance_partner_payments WHERE id = NEW.payment_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a submitted partner payment is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_partner_paid_lines_no_delete_after_submit BEFORE DELETE ON finance_partner_paid_lines
WHEN (SELECT state FROM finance_partner_payments WHERE id = OLD.payment_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a paid line of a submitted partner payment is permanent');
END;
--> statement-breakpoint
-- Nachweis: nach dem Anerkennen nur das Leeren von `document_id` erlaubt (Grabstein), gelöscht wird er nur davor (Annahme 11).
CREATE TRIGGER finance_partner_evidence_immutable_after_ack BEFORE UPDATE ON finance_partner_evidence
WHEN (SELECT acknowledged_at FROM finance_partner_payments WHERE id = OLD.payment_id) IS NOT NULL AND (
  NEW.id IS NOT OLD.id OR NEW.payment_id IS NOT OLD.payment_id OR NEW.kind IS NOT OLD.kind OR NEW.foreign_language IS NOT OLD.foreign_language
  OR NEW.explanation_de IS NOT OLD.explanation_de OR NEW.covered_cents IS NOT OLD.covered_cents OR NEW.added_by_user_id IS NOT OLD.added_by_user_id OR NEW.added_at IS NOT OLD.added_at
  OR (NEW.document_id IS NOT OLD.document_id AND NEW.document_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'evidence of an acknowledged partner payment is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_partner_evidence_no_delete_after_ack BEFORE DELETE ON finance_partner_evidence
WHEN (SELECT acknowledged_at FROM finance_partner_payments WHERE id = OLD.payment_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'evidence of an acknowledged partner payment is permanent');
END;

--> statement-breakpoint
-- Quelle: 0031_finance_reserves_transfers.sql
CREATE TABLE `finance_purpose_transfer_counters` (
	`year` integer PRIMARY KEY NOT NULL,
	`last` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_purpose_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`from_purpose_id` text,
	`to_purpose_id` text,
	`amount_cents` integer NOT NULL,
	`transfer_date` text NOT NULL,
	`reason` text NOT NULL,
	`document_id` text,
	`state` text DEFAULT 'submitted' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`approved_channel` text,
	`rejected_by_user_id` text,
	`rejected_at` text,
	`reject_note` text,
	FOREIGN KEY (`from_purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_purpose_transfers_number_idx` ON `finance_purpose_transfers` (`number`);--> statement-breakpoint
CREATE INDEX `finance_purpose_transfers_from_idx` ON `finance_purpose_transfers` (`from_purpose_id`);--> statement-breakpoint
CREATE INDEX `finance_purpose_transfers_to_idx` ON `finance_purpose_transfers` (`to_purpose_id`);--> statement-breakpoint
CREATE INDEX `finance_purpose_transfers_state_idx` ON `finance_purpose_transfers` (`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_reserve_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`reserve_id` text NOT NULL,
	`kind` text NOT NULL,
	`movement_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`for_fiscal_year_id` text,
	`resolution_document_id` text,
	`note` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`reserve_id`) REFERENCES `finance_reserves`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`for_fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_reserve_movements_reserve_idx` ON `finance_reserve_movements` (`reserve_id`,`movement_date`);--> statement-breakpoint
CREATE INDEX `finance_reserve_movements_year_idx` ON `finance_reserve_movements` (`for_fiscal_year_id`);--> statement-breakpoint
CREATE TABLE `finance_reserves` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`purpose_text` text,
	`purpose_id` text,
	`resolution_document_id` text,
	`carry_forward_cents` integer,
	`carry_forward_date` text,
	`carry_forward_document_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_reserves_purpose_idx` ON `finance_reserves` (`purpose_id`);--> statement-breakpoint
CREATE INDEX `finance_reserves_active_idx` ON `finance_reserves` (`is_active`);--> statement-breakpoint
ALTER TABLE `finance_purposes` ADD `reopen_note` text;--> statement-breakpoint
ALTER TABLE `finance_purposes` ADD `reopened_at` text;--> statement-breakpoint
ALTER TABLE `finance_purposes` ADD `reopened_by_user_id` text;--> statement-breakpoint
-- Von Hand angefügt (F8b Task 1): Ein Vorgang an zurückgelegtem Geld ist unveränderlich und wird nie gelöscht — nur
-- das Leeren des Beschlusses ist erlaubt (Grabstein nach Ablauf der Dokumentfrist).
CREATE TRIGGER finance_reserve_movements_immutable BEFORE UPDATE ON finance_reserve_movements
WHEN NEW.id IS NOT OLD.id OR NEW.reserve_id IS NOT OLD.reserve_id OR NEW.kind IS NOT OLD.kind OR NEW.movement_date IS NOT OLD.movement_date
  OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.for_fiscal_year_id IS NOT OLD.for_fiscal_year_id OR NEW.note IS NOT OLD.note
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.resolution_document_id IS NOT OLD.resolution_document_id AND NEW.resolution_document_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'a movement of reserved funds is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_reserve_movements_no_delete BEFORE DELETE ON finance_reserve_movements
BEGIN
  SELECT RAISE(ABORT, 'a movement of reserved funds is permanent');
END;
--> statement-breakpoint
-- Zurückgelegtes Geld mit Vorgängen oder einem Vortrag wird nicht gelöscht (Annahme 1) — der Dienst prüft das schon;
-- der Trigger sichert es zusätzlich auf Datenbankebene.
CREATE TRIGGER finance_reserves_no_delete_used BEFORE DELETE ON finance_reserves
WHEN OLD.carry_forward_cents IS NOT NULL OR EXISTS (SELECT 1 FROM finance_reserve_movements WHERE reserve_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'reserved funds with movements or a carry-forward are permanent');
END;
--> statement-breakpoint
-- Eine Umwidmung entsteht ohne Entwurf, schon als `submitted` mit Nummer; `state` verlässt `submitted` genau einmal,
-- der Kopf ist danach unveränderlich außer den Entscheidungsfeldern, die selbst nur bis dahin änderbar sind.
CREATE TRIGGER finance_purpose_transfers_immutable BEFORE UPDATE ON finance_purpose_transfers
WHEN NEW.id IS NOT OLD.id OR NEW.number IS NOT OLD.number OR NEW.from_purpose_id IS NOT OLD.from_purpose_id OR NEW.to_purpose_id IS NOT OLD.to_purpose_id
  OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.transfer_date IS NOT OLD.transfer_date OR NEW.reason IS NOT OLD.reason
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.document_id IS NOT OLD.document_id AND NEW.document_id IS NOT NULL)
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_channel IS NOT OLD.approved_channel
    OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.reject_note IS NOT OLD.reject_note
  ))
BEGIN
  SELECT RAISE(ABORT, 'a purpose transfer is permanent once decided');
END;
--> statement-breakpoint
CREATE TRIGGER finance_purpose_transfers_no_delete BEFORE DELETE ON finance_purpose_transfers
BEGIN
  SELECT RAISE(ABORT, 'a purpose transfer is permanent');
END;
--> statement-breakpoint
-- Quelle: 0032_animals_place.sql
ALTER TABLE `animals` ADD `place` text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Quelle: 0033_finance_open_item_probably_paid.sql
ALTER TABLE `finance_open_items` ADD `probably_paid_reason` text;
--> statement-breakpoint
-- Quelle: 0034_finance_related_reference_not_return.sql
CREATE TABLE `finance_not_return_marks` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`by_user_id` text NOT NULL,
	`at` text NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` text,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `finance_raw_transactions` ADD `related_reference` text;--> statement-breakpoint
-- Von Hand angefügt: Auch der Bezug auf eine frühere Transaktion (AC) ist ab dem Einlesen unveränderlich.
DROP TRIGGER finance_raw_transactions_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_raw_transactions_no_update BEFORE UPDATE OF id, run_id, account_id, booking_date, value_date, amount_cents, counterparty_name, counterparty_iban, purpose, bank_reference, end_to_end_id, return_code, related_reference, dedup_key, line_index, created_at ON finance_raw_transactions
BEGIN
  SELECT RAISE(ABORT, 'a raw transaction is a permanent record');
END;

--> statement-breakpoint
-- Quelle: 0035_finance_counterparty_email.sql
ALTER TABLE `finance_raw_transactions` ADD `counterparty_email` text;--> statement-breakpoint
-- Von Hand angefügt: Auch die E-Mail der Gegenseite (AB) ist ab dem Einlesen unveränderlich.
DROP TRIGGER finance_raw_transactions_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_raw_transactions_no_update BEFORE UPDATE OF id, run_id, account_id, booking_date, value_date, amount_cents, counterparty_name, counterparty_iban, counterparty_email, purpose, bank_reference, end_to_end_id, return_code, related_reference, dedup_key, line_index, created_at ON finance_raw_transactions
BEGIN
  SELECT RAISE(ABORT, 'a raw transaction is a permanent record');
END;

--> statement-breakpoint
-- Quelle: 0036_finance_board_allowance_reason.sql
ALTER TABLE `finance_entries` ADD `board_allowance_reason` text;--> statement-breakpoint
-- Von Hand angefügt: Die Begründung einer Vorstandspauschale ohne Grundlage (AH) ist nach dem Festschreiben unveränderlich.
DROP TRIGGER finance_entries_final_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_entries_final_no_update BEFORE UPDATE OF id, number, entry_date, text, status, fiscal_year_id, reviewed_at, reviewed_by_user_id, reviewed_channel, finalized_at, finalized_by_user_id, finalized_channel, reverses_entry_id, correction_of_entry_id, cash_warning_reason, board_allowance_reason, created_by_user_id, created_channel, created_at ON finance_entries
WHEN OLD.status = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;

--> statement-breakpoint
-- Quelle: 0037_finance_partner_proof_months.sql
ALTER TABLE `finance_partner_payments` ADD `proof_months` integer;--> statement-breakpoint
ALTER TABLE `finance_partner_profiles` ADD `usual_proof_months` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
-- Von Hand eingefügt (Design-Nachtrag Phase 4, Entscheidung 2): die übliche Frist von Tagen in Monate, gerundet, mindestens einer — vor dem Löschen der alten Spalte.
UPDATE `finance_partner_profiles` SET `usual_proof_months` = MAX(1, CAST(ROUND(`usual_proof_days` / 30.0) AS INTEGER));--> statement-breakpoint
ALTER TABLE `finance_partner_profiles` DROP COLUMN `usual_proof_days`;--> statement-breakpoint
-- Von Hand angefügt: Die Nachweisfrist einer Zahlung in Monaten ist ab dem Einreichen so fest wie alles andere, was eingereicht wurde.
DROP TRIGGER finance_partner_payments_submitted_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_partner_payments_submitted_immutable BEFORE UPDATE ON finance_partner_payments
WHEN OLD.state <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.partner_id IS NOT OLD.partner_id OR NEW.basis IS NOT OLD.basis OR NEW.basis_overridden IS NOT OLD.basis_overridden
  OR NEW.basis_override_reason IS NOT OLD.basis_override_reason OR NEW.purpose_text IS NOT OLD.purpose_text OR NEW.agreement_document_id IS NOT OLD.agreement_document_id
  OR NEW.retroactive IS NOT OLD.retroactive OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.copied_from_payment_id IS NOT OLD.copied_from_payment_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.proof_months IS NOT OLD.proof_months
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.number IS NOT OLD.number OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
    OR NEW.approved_channel IS NOT OLD.approved_channel OR NEW.open_item_id IS NOT OLD.open_item_id OR NEW.proof_due_on IS NOT OLD.proof_due_on
    OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.reject_note IS NOT OLD.reject_note
    OR (NEW.notice_reason IS NOT OLD.notice_reason AND OLD.notice_reason IS NOT NULL)
    OR (NEW.overdue_reason IS NOT OLD.overdue_reason AND OLD.overdue_reason IS NOT NULL)
  ))
  OR (OLD.state <> 'approved' AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
  OR (OLD.acknowledged_at IS NOT NULL AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
)
BEGIN
  SELECT RAISE(ABORT, 'a submitted partner payment is permanent');
END;

--> statement-breakpoint
-- Quelle: 0038_finance_partner_notice_abroad.sql
ALTER TABLE `finance_partner_notices` ADD `valid_until` text;
--> statement-breakpoint
-- Quelle: 0039_finance_reason_purpose_cap.sql
ALTER TABLE `finance_entries` ADD `purpose_negative_reason` text;--> statement-breakpoint
ALTER TABLE `finance_partner_payments` ADD `purpose_negative_reason` text;--> statement-breakpoint
ALTER TABLE `finance_reserve_movements` ADD `cap_reason` text;--> statement-breakpoint
-- Von Hand angefügt (Befund Q): Die Begründung für einen Zweck im Minus ist nach dem Festschreiben unveränderlich.
DROP TRIGGER finance_entries_final_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_entries_final_no_update BEFORE UPDATE OF id, number, entry_date, text, status, fiscal_year_id, reviewed_at, reviewed_by_user_id, reviewed_channel, finalized_at, finalized_by_user_id, finalized_channel, reverses_entry_id, correction_of_entry_id, cash_warning_reason, board_allowance_reason, purpose_negative_reason, created_by_user_id, created_channel, created_at ON finance_entries
WHEN OLD.status = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
-- Von Hand angefügt (Befund Q): Die Begründung beim Einreichen einer Zahlung an Partner bleibt wie alles Eingereichte.
DROP TRIGGER finance_partner_payments_submitted_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_partner_payments_submitted_immutable BEFORE UPDATE ON finance_partner_payments
WHEN OLD.state <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.partner_id IS NOT OLD.partner_id OR NEW.basis IS NOT OLD.basis OR NEW.basis_overridden IS NOT OLD.basis_overridden
  OR NEW.basis_override_reason IS NOT OLD.basis_override_reason OR NEW.purpose_text IS NOT OLD.purpose_text OR NEW.agreement_document_id IS NOT OLD.agreement_document_id
  OR NEW.retroactive IS NOT OLD.retroactive OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.copied_from_payment_id IS NOT OLD.copied_from_payment_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.proof_months IS NOT OLD.proof_months
  OR NEW.purpose_negative_reason IS NOT OLD.purpose_negative_reason
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.number IS NOT OLD.number OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
    OR NEW.approved_channel IS NOT OLD.approved_channel OR NEW.open_item_id IS NOT OLD.open_item_id OR NEW.proof_due_on IS NOT OLD.proof_due_on
    OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.reject_note IS NOT OLD.reject_note
    OR (NEW.notice_reason IS NOT OLD.notice_reason AND OLD.notice_reason IS NOT NULL)
    OR (NEW.overdue_reason IS NOT OLD.overdue_reason AND OLD.overdue_reason IS NOT NULL)
  ))
  OR (OLD.state <> 'approved' AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
  OR (OLD.acknowledged_at IS NOT NULL AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
)
BEGIN
  SELECT RAISE(ABORT, 'a submitted partner payment is permanent');
END;
--> statement-breakpoint
-- Von Hand angefügt (Befund S): Die Begründung über dem Höchstbetrag ist Teil des unveränderlichen Vorgangs.
DROP TRIGGER finance_reserve_movements_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_reserve_movements_immutable BEFORE UPDATE ON finance_reserve_movements
WHEN NEW.id IS NOT OLD.id OR NEW.reserve_id IS NOT OLD.reserve_id OR NEW.kind IS NOT OLD.kind OR NEW.movement_date IS NOT OLD.movement_date
  OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.for_fiscal_year_id IS NOT OLD.for_fiscal_year_id OR NEW.note IS NOT OLD.note
  OR NEW.cap_reason IS NOT OLD.cap_reason
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.resolution_document_id IS NOT OLD.resolution_document_id AND NEW.resolution_document_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'a movement of reserved funds is permanent');
END;

--> statement-breakpoint
-- Quelle: 0040_finance_approval_purpose_reason.sql
ALTER TABLE `finance_expense_claims` ADD `purpose_negative_reason` text;--> statement-breakpoint
-- Von Hand angefügt (Q Rest): Die Begründung für einen Zweck im Minus entsteht bei der Freigabe einer Auslage und bleibt danach wie alles Entschiedene.
DROP TRIGGER finance_expense_claims_submitted_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_expense_claims_submitted_immutable BEFORE UPDATE ON finance_expense_claims
WHEN OLD.state <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.number IS NOT OLD.number OR NEW.contact_id IS NOT OLD.contact_id OR NEW.submitted_by_user_id IS NOT OLD.submitted_by_user_id
  OR NEW.iban IS NOT OLD.iban OR NEW.waiver IS NOT OLD.waiver OR NEW.recurring IS NOT OLD.recurring OR NEW.waiver_basis_text IS NOT OLD.waiver_basis_text
  OR NEW.waiver_agreed_on IS NOT OLD.waiver_agreed_on OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.copied_from_claim_id IS NOT OLD.copied_from_claim_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
    OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.reject_note IS NOT OLD.reject_note
    OR NEW.open_item_id IS NOT OLD.open_item_id OR NEW.entry_id IS NOT OLD.entry_id OR NEW.claim_agreed_confirmed IS NOT OLD.claim_agreed_confirmed
    OR NEW.waiver_late_reason IS NOT OLD.waiver_late_reason OR NEW.waiver_free_funds_cents IS NOT OLD.waiver_free_funds_cents
    OR NEW.waiver_declared_on IS NOT OLD.waiver_declared_on
    OR NEW.purpose_negative_reason IS NOT OLD.purpose_negative_reason
    OR (NEW.waiver_declaration_document_id IS NOT OLD.waiver_declaration_document_id AND NEW.waiver_declaration_document_id IS NOT NULL)
  ))
  OR (OLD.waiver_signed_document_id IS NOT NULL AND NEW.waiver_signed_document_id IS NOT NULL AND NEW.waiver_signed_document_id IS NOT OLD.waiver_signed_document_id)
)
BEGIN
  SELECT RAISE(ABORT, 'a submitted expense claim is permanent');
END;
--> statement-breakpoint
-- Von Hand angefügt (Q Rest): Die Freigabe einer Zahlung an Partner darf eine Begründung ergänzen, die beim Einreichen fehlte — nie eine vorhandene ändern, danach nichts mehr.
DROP TRIGGER finance_partner_payments_submitted_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_partner_payments_submitted_immutable BEFORE UPDATE ON finance_partner_payments
WHEN OLD.state <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.partner_id IS NOT OLD.partner_id OR NEW.basis IS NOT OLD.basis OR NEW.basis_overridden IS NOT OLD.basis_overridden
  OR NEW.basis_override_reason IS NOT OLD.basis_override_reason OR NEW.purpose_text IS NOT OLD.purpose_text OR NEW.agreement_document_id IS NOT OLD.agreement_document_id
  OR NEW.retroactive IS NOT OLD.retroactive OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.copied_from_payment_id IS NOT OLD.copied_from_payment_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.proof_months IS NOT OLD.proof_months
  OR (NEW.purpose_negative_reason IS NOT OLD.purpose_negative_reason AND (OLD.purpose_negative_reason IS NOT NULL OR OLD.state <> 'submitted'))
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.number IS NOT OLD.number OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
    OR NEW.approved_channel IS NOT OLD.approved_channel OR NEW.open_item_id IS NOT OLD.open_item_id OR NEW.proof_due_on IS NOT OLD.proof_due_on
    OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.reject_note IS NOT OLD.reject_note
    OR (NEW.notice_reason IS NOT OLD.notice_reason AND OLD.notice_reason IS NOT NULL)
    OR (NEW.overdue_reason IS NOT OLD.overdue_reason AND OLD.overdue_reason IS NOT NULL)
  ))
  OR (OLD.state <> 'approved' AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
  OR (OLD.acknowledged_at IS NOT NULL AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
)
BEGIN
  SELECT RAISE(ABORT, 'a submitted partner payment is permanent');
END;
