-- Fassung 0.3.0: die Entwicklungsmigrationen 0009_naive_gabe_jones bis 0032_freezing_justin_hammer,
-- unverändert in ihrer Reihenfolge verkettet (nicht neu erzeugt), damit Daten-
-- und Trigger-Umbauten auf Bestandsdaten genauso wirken wie in der alten Reihe.
-- Quelle: 0009_naive_gabe_jones.sql
ALTER TABLE `finance_open_item_settlements` ADD `reverses_settlement_id` text;--> statement-breakpoint
CREATE INDEX `finance_open_item_settlements_reverses_idx` ON `finance_open_item_settlements` (`reverses_settlement_id`);
--> statement-breakpoint
-- Quelle: 0010_square_nitro.sql
CREATE TABLE `member_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`member_number` text,
	`applied_on` text,
	`admitted_on` text,
	`rejected_on` text,
	`joined_on` text,
	`ends_on` text,
	`end_reason` text,
	`end_notice_on` text,
	`end_document_id` text,
	`birth_date` text,
	`guardian_contact_id` text,
	`application_document_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_memberships_number_idx` ON `member_memberships` (`member_number`);--> statement-breakpoint
CREATE INDEX `member_memberships_contact_idx` ON `member_memberships` (`contact_id`);--> statement-breakpoint
CREATE TABLE `member_number_counter` (
	`id` text PRIMARY KEY NOT NULL,
	`last` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member_type_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`type_id` text NOT NULL,
	`valid_from` text NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `member_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `member_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_type_periods_day_idx` ON `member_type_periods` (`membership_id`,`valid_from`);--> statement-breakpoint
CREATE INDEX `member_type_periods_type_idx` ON `member_type_periods` (`type_id`);--> statement-breakpoint
CREATE TABLE `member_types` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`has_voting_right` integer DEFAULT false NOT NULL,
	`fee_exempt` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_types_key_idx` ON `member_types` (`key`);--> statement-breakpoint
CREATE INDEX `member_types_sort_idx` ON `member_types` (`sort_order`);
--> statement-breakpoint
-- Quelle: 0011_polite_red_skull.sql
ALTER TABLE `contacts` ADD `delivery_preference` text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
-- Quelle: 0012_wonderful_spyke.sql
CREATE TABLE `dms_mail_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`body_snippet_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`sending_since` text,
	`last_error_code` text,
	`last_error_text` text,
	`message_id` text,
	`queued_by_user_id` text,
	`queued_at` text NOT NULL,
	`sent_at` text,
	`run_ref` text,
	`address_purged_at` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dms_mail_outbox_document_contact_idx` ON `dms_mail_outbox` (`document_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `dms_mail_outbox_status_idx` ON `dms_mail_outbox` (`status`);
--> statement-breakpoint
-- Quelle: 0013_parched_morg.sql
CREATE TABLE `member_fee_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`amount_cents` integer,
	`interval` text,
	`payment_method` text DEFAULT 'transfer' NOT NULL,
	`mandate_id` text,
	`reduction` text DEFAULT 'none' NOT NULL,
	`reduction_document_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `member_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_fee_agreements_day_idx` ON `member_fee_agreements` (`membership_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `member_fee_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_on` text NOT NULL,
	`deferred_to` text,
	`open_item_id` text,
	`run_id` text,
	`state` text NOT NULL,
	`skip_reason` text,
	`replaced_by_id` text,
	FOREIGN KEY (`membership_id`) REFERENCES `member_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `member_fee_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_fee_charges_period_idx` ON `member_fee_charges` (`membership_id`,`period_start`) WHERE "member_fee_charges"."state" <> 'replaced';--> statement-breakpoint
CREATE INDEX `member_fee_charges_run_idx` ON `member_fee_charges` (`run_id`);--> statement-breakpoint
CREATE INDEX `member_fee_charges_open_item_idx` ON `member_fee_charges` (`open_item_id`);--> statement-breakpoint
CREATE TABLE `member_fee_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`type_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`interval` text NOT NULL,
	`minimum` integer DEFAULT false NOT NULL,
	`allowed_intervals` text NOT NULL,
	`admission_fee_cents` integer,
	FOREIGN KEY (`schedule_id`) REFERENCES `member_fee_schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `member_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_fee_rules_schedule_type_idx` ON `member_fee_rules` (`schedule_id`,`type_id`);--> statement-breakpoint
CREATE INDEX `member_fee_rules_type_idx` ON `member_fee_rules` (`type_id`);--> statement-breakpoint
CREATE TABLE `member_fee_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`status` text NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `member_fee_runs_year_idx` ON `member_fee_runs` (`year`);--> statement-breakpoint
CREATE TABLE `member_fee_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`valid_from` text NOT NULL,
	`resolved_on` text,
	`resolution_document_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_fee_schedules_valid_from_idx` ON `member_fee_schedules` (`valid_from`);
--> statement-breakpoint
-- Quelle: 0014_neat_the_captain.sql
CREATE TABLE `finance_pledge_rate_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`pledge_id` text NOT NULL,
	`due_on` text NOT NULL,
	`mark` text NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`pledge_id`) REFERENCES `finance_pledges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_pledge_rate_marks_rate_idx` ON `finance_pledge_rate_marks` (`pledge_id`,`due_on`);--> statement-breakpoint
CREATE TABLE `finance_pledges` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`interval` text NOT NULL,
	`first_due_on` text NOT NULL,
	`last_due_on` text,
	`payment_method` text NOT NULL,
	`mandate_id` text,
	`purpose_id` text,
	`project_id` text,
	`paused_from` text,
	`paused_until` text,
	`ended_on` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`mandate_id`) REFERENCES `finance_sepa_mandates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_pledges_contact_idx` ON `finance_pledges` (`contact_id`);--> statement-breakpoint
CREATE INDEX `finance_pledges_mandate_idx` ON `finance_pledges` (`mandate_id`);--> statement-breakpoint
CREATE TABLE `finance_sepa_counter` (
	`id` text PRIMARY KEY NOT NULL,
	`last` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_sepa_mandate_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`field` text NOT NULL,
	`before` text,
	`after` text,
	`valid_from` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	FOREIGN KEY (`mandate_id`) REFERENCES `finance_sepa_mandates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_sepa_mandate_changes_mandate_idx` ON `finance_sepa_mandate_changes` (`mandate_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `finance_sepa_mandates` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`reference` text NOT NULL,
	`debtor_name` text NOT NULL,
	`iban` text NOT NULL,
	`bic` text,
	`sequence` text DEFAULT 'recurring' NOT NULL,
	`prepared_on` text NOT NULL,
	`signed_on` text,
	`signed_document_id` text,
	`ended_on` text,
	`end_reason` text,
	`last_collected_on` text,
	`pending_amendment` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_sepa_mandates_reference_idx` ON `finance_sepa_mandates` (`reference`);--> statement-breakpoint
CREATE INDEX `finance_sepa_mandates_contact_idx` ON `finance_sepa_mandates` (`contact_id`);
--> statement-breakpoint
-- Quelle: 0015_l1_no_delete.sql
-- Custom SQL migration file, put your code below! --
CREATE TRIGGER finance_sepa_mandates_no_delete BEFORE DELETE ON finance_sepa_mandates
BEGIN
  SELECT RAISE(ABORT, 'a mandate is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_pledges_no_delete BEFORE DELETE ON finance_pledges
BEGIN
  SELECT RAISE(ABORT, 'a pledge is permanent');
END;

--> statement-breakpoint
-- Quelle: 0016_lumpy_spyke.sql
CREATE TABLE `finance_direct_debit_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`installment_on` text,
	`amount_cents` integer NOT NULL,
	`end_to_end_id` text NOT NULL,
	`remittance` text NOT NULL,
	`amendment` text,
	`removed_at` text,
	`removed_by_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `finance_direct_debit_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mandate_id`) REFERENCES `finance_sepa_mandates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_direct_debit_items_e2e_idx` ON `finance_direct_debit_items` (`end_to_end_id`);--> statement-breakpoint
CREATE INDEX `finance_direct_debit_items_run_idx` ON `finance_direct_debit_items` (`run_id`);--> statement-breakpoint
CREATE INDEX `finance_direct_debit_items_source_idx` ON `finance_direct_debit_items` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `finance_direct_debit_items_mandate_idx` ON `finance_direct_debit_items` (`mandate_id`);--> statement-breakpoint
CREATE TABLE `finance_direct_debit_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_date` text NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`message_id` text NOT NULL,
	`file_name` text,
	`file_created_at` text,
	`file_created_by_user_id` text,
	`submitted_on` text,
	`submitted_by_user_id` text,
	`cancelled_at` text,
	`cancelled_by_user_id` text,
	`summary_document_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_direct_debit_runs_message_idx` ON `finance_direct_debit_runs` (`message_id`);--> statement-breakpoint
CREATE INDEX `finance_direct_debit_runs_date_idx` ON `finance_direct_debit_runs` (`collection_date`);--> statement-breakpoint
CREATE TABLE `finance_sepa_prenotifications` (
	`id` text PRIMARY KEY NOT NULL,
	`mandate_id` text NOT NULL,
	`document_id` text NOT NULL,
	`issued_on` text NOT NULL,
	`plan` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mandate_id`) REFERENCES `finance_sepa_mandates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_sepa_prenotifications_mandate_idx` ON `finance_sepa_prenotifications` (`mandate_id`);
--> statement-breakpoint
-- Quelle: 0017_l2_no_delete.sql
-- Custom SQL migration file, put your code below! --
CREATE TRIGGER finance_direct_debit_runs_no_delete BEFORE DELETE ON finance_direct_debit_runs
BEGIN
  SELECT RAISE(ABORT, 'a direct debit run is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_direct_debit_items_no_delete BEFORE DELETE ON finance_direct_debit_items
BEGIN
  SELECT RAISE(ABORT, 'a direct debit item is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_sepa_prenotifications_no_delete BEFORE DELETE ON finance_sepa_prenotifications
BEGIN
  SELECT RAISE(ABORT, 'a prenotification is permanent');
END;

--> statement-breakpoint
-- Quelle: 0018_chubby_leo.sql
ALTER TABLE `finance_sepa_prenotifications` DROP COLUMN `issued_on`;
--> statement-breakpoint
-- Quelle: 0019_icy_shiver_man.sql
ALTER TABLE `documents` ADD `filed_at` text;
--> statement-breakpoint
-- Quelle: 0020_dms_filed_at_backfill.sql
-- Custom SQL migration file, put your code below! --
UPDATE documents SET filed_at = created_at WHERE phase = 'issued' AND filed_at IS NULL;

--> statement-breakpoint
-- Quelle: 0021_gifted_darwin.sql
ALTER TABLE `finance_raw_transactions` ADD `mandate_reference` text;--> statement-breakpoint
ALTER TABLE `finance_raw_transactions` ADD `creditor_id` text;
--> statement-breakpoint
-- Quelle: 0022_sticky_scarlet_spider.sql
ALTER TABLE `finance_allocation_lines` ADD `direct_debit_item_id` text;--> statement-breakpoint
CREATE INDEX `finance_allocation_lines_direct_debit_item_idx` ON `finance_allocation_lines` (`direct_debit_item_id`);
--> statement-breakpoint
-- Quelle: 0023_misty_strong_guy.sql
CREATE TABLE `finance_direct_debit_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`raw_transaction_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`return_code` text,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`resolution` text,
	`mandate_ended` integer DEFAULT false NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `finance_direct_debit_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_direct_debit_returns_raw_item_idx` ON `finance_direct_debit_returns` (`raw_transaction_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `finance_direct_debit_returns_item_idx` ON `finance_direct_debit_returns` (`item_id`);--> statement-breakpoint
CREATE INDEX `finance_direct_debit_returns_status_idx` ON `finance_direct_debit_returns` (`status`);
--> statement-breakpoint
-- Quelle: 0024_finance_l3_triggers.sql
-- Custom SQL migration file, put your code below! --
-- Plan L3: Mandatsreferenz und Gläubiger-ID sind ab dem Einlesen unveränderlich wie der übrige Rohumsatz.
DROP TRIGGER finance_raw_transactions_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_raw_transactions_no_update BEFORE UPDATE OF id, run_id, account_id, booking_date, value_date, amount_cents, counterparty_name, counterparty_iban, counterparty_email, purpose, bank_reference, end_to_end_id, return_code, mandate_reference, creditor_id, related_reference, dedup_key, line_index, created_at ON finance_raw_transactions
BEGIN
  SELECT RAISE(ABORT, 'a raw transaction is a permanent record');
END;
--> statement-breakpoint
-- Plan L3: Der Posten eines Einzugs an der Zeile ist Teil der festgeschriebenen Buchung.
DROP TRIGGER finance_allocation_lines_final_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_lines_final_no_update BEFORE UPDATE OF id, entry_id, position, category_id, amount_cents, tax_code, rate_kind, origin_line_id, adds_to_assets, direct_debit_item_id ON finance_allocation_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;

--> statement-breakpoint
-- Quelle: 0025_dazzling_wendell_vaughn.sql
CREATE TABLE `member_run_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`run_ref` text NOT NULL,
	`membership_id` text NOT NULL,
	`document_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `member_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_run_letters_document_idx` ON `member_run_letters` (`run_ref`,`document_id`);--> statement-breakpoint
CREATE INDEX `member_run_letters_membership_idx` ON `member_run_letters` (`membership_id`);
--> statement-breakpoint
-- Quelle: 0026_first_chameleon.sql
CREATE TABLE `member_dunning_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`level_key` text NOT NULL,
	`document_id` text NOT NULL,
	`charge_ids` text NOT NULL,
	`run_id` text,
	`issued_on` text NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `member_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `member_dunning_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_dunning_notices_membership_idx` ON `member_dunning_notices` (`membership_id`);--> statement-breakpoint
CREATE INDEX `member_dunning_notices_run_idx` ON `member_dunning_notices` (`run_id`);--> statement-breakpoint
CREATE TABLE `member_dunning_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`as_of` text NOT NULL,
	`status` text NOT NULL,
	`refused` text NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `member_dunning_runs_status_idx` ON `member_dunning_runs` (`status`);
--> statement-breakpoint
-- Quelle: 0027_skinny_skaar.sql
ALTER TABLE `member_fee_runs` ADD `notices` text DEFAULT 'directDebitOnly' NOT NULL;--> statement-breakpoint
ALTER TABLE `member_fee_runs` ADD `notice_refused` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
-- Quelle: 0028_cool_brood.sql
CREATE TABLE `member_transfer_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`document_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `member_fee_charges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_transfer_requests_charge_idx` ON `member_transfer_requests` (`charge_id`);--> statement-breakpoint
ALTER TABLE `member_fee_charges` ADD `payment_method` text DEFAULT 'transfer' NOT NULL;
--> statement-breakpoint
-- Quelle: 0029_numerous_skrulls.sql
ALTER TABLE `finance_direct_debit_runs` ADD `file_mandates` text;
--> statement-breakpoint
-- Quelle: 0030_shallow_fenris.sql
ALTER TABLE `member_fee_charges` ADD `schedule_id` text;
--> statement-breakpoint
-- Quelle: 0031_pale_captain_britain.sql
CREATE TABLE `dms_mail_post_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`run_ref` text,
	`moved_at` text NOT NULL,
	`moved_by_user_id` text,
	`returned_at` text,
	`returned_by_user_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dms_mail_post_moves_document_contact_idx` ON `dms_mail_post_moves` (`document_id`,`contact_id`);
--> statement-breakpoint
-- Quelle: 0032_freezing_justin_hammer.sql
ALTER TABLE `finance_contact_bank_accounts` ADD `source` text;--> statement-breakpoint
ALTER TABLE `finance_contact_bank_accounts` ADD `learned_from_entry_date` text;