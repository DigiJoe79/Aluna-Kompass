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