ALTER TABLE `website_publishes` RENAME TO `site_publishes`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_site_publishes` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`pages_changed` integer DEFAULT 0 NOT NULL,
	`pages_added` integer DEFAULT 0 NOT NULL,
	`pages_removed` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`triggered_by_user_id` text,
	`log` text DEFAULT '' NOT NULL,
	`file_manifest` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_site_publishes`("id", "environment", "started_at", "finished_at", "status", "content_hash", "pages_changed", "pages_added", "pages_removed", "summary", "triggered_by_user_id", "log", "file_manifest") SELECT "id", "environment", "started_at", "finished_at", "status", "content_hash", "pages_changed", "pages_added", "pages_removed", "summary", "triggered_by_user_id", "log", "file_manifest" FROM `site_publishes`;--> statement-breakpoint
DROP TABLE `site_publishes`;--> statement-breakpoint
ALTER TABLE `__new_site_publishes` RENAME TO `site_publishes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;