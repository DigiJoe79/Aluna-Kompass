CREATE TABLE `site_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`collection` text NOT NULL,
	`slug` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_entries_collection` ON `site_entries` (`collection`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_entries_slug` ON `site_entries` (`collection`,`slug`);--> statement-breakpoint
CREATE TABLE `site_template_state` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`schema_json` text NOT NULL,
	`checksum` text NOT NULL,
	`read_at` text NOT NULL,
	`read_by_user_id` text
);
--> statement-breakpoint
CREATE TABLE `site_values` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
