PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_animals` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`species` text DEFAULT 'dog' NOT NULL,
	`sex` text NOT NULL,
	`birth_text` text NOT NULL,
	`size_cm` integer DEFAULT 0 NOT NULL,
	`size_text` text NOT NULL,
	`location` text DEFAULT 'shelter' NOT NULL,
	`status` text DEFAULT 'lookingForHome' NOT NULL,
	`is_emergency` integer DEFAULT false NOT NULL,
	`is_sponsorable` integer DEFAULT false NOT NULL,
	`traits` text DEFAULT '{}' NOT NULL,
	`external_profile_url` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_animals`("id", "slug", "name", "species", "sex", "birth_text", "size_cm", "size_text", "location", "status", "is_emergency", "is_sponsorable", "traits", "external_profile_url", "summary", "body", "is_published", "created_at", "updated_at") SELECT "id", "slug", "name", "species", "sex", "birth_text", "size_cm", "size_text", "location", "status", "is_emergency", "is_sponsorable", "traits", "external_profile_url", "summary", "body", "is_published", "created_at", "updated_at" FROM `animals`;--> statement-breakpoint
DROP TABLE `animals`;--> statement-breakpoint
ALTER TABLE `__new_animals` RENAME TO `animals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `animals_slug_unique` ON `animals` (`slug`);--> statement-breakpoint
CREATE INDEX `animals_status_idx` ON `animals` (`status`);