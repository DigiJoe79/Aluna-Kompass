CREATE TABLE `website_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`lede` text NOT NULL,
	`body` text NOT NULL,
	`published_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `website_articles_slug_unique` ON `website_articles` (`slug`);--> statement-breakpoint
CREATE INDEX `website_articles_sort_idx` ON `website_articles` (`sort_order`);--> statement-breakpoint
CREATE TABLE `website_downloads` (
	`key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`asset_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `website_faqs` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `website_pages` (
	`key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`lede` text NOT NULL,
	`body` text NOT NULL,
	`meta_description` text NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `website_publishes` (
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
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `website_team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`photo_asset_id` text,
	`pet_photo_asset_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`photo_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pet_photo_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action
);
