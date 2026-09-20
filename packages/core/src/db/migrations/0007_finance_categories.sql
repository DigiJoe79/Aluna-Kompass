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