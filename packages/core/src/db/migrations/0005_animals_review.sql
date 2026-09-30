ALTER TABLE `animals` ADD `review_requested_at` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `review_note` text DEFAULT '' NOT NULL;