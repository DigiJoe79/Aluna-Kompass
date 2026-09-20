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