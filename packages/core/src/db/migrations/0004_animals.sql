CREATE TABLE `animal_photos` (
	`animal_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`animal_id`, `asset_id`),
	FOREIGN KEY (`animal_id`) REFERENCES `animals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `animal_stories` (
	`animal_id` text PRIMARY KEY NOT NULL,
	`before_asset_id` text,
	`after_asset_id` text,
	`quote` text NOT NULL,
	`family` text DEFAULT '' NOT NULL,
	`adopted_year` integer NOT NULL,
	FOREIGN KEY (`animal_id`) REFERENCES `animals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`before_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`after_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `animals` (
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
	`traits` text DEFAULT '{"de":[],"en":[]}' NOT NULL,
	`external_profile_url` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `animals_slug_unique` ON `animals` (`slug`);--> statement-breakpoint
CREATE INDEX `animals_status_idx` ON `animals` (`status`);