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
