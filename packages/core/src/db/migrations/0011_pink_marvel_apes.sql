CREATE TABLE `media_folders` (
	`path` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `folder` text;