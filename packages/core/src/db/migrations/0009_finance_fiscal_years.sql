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