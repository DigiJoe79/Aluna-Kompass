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