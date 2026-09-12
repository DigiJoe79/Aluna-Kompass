CREATE TABLE `document_counters` (
	`prefix` text NOT NULL,
	`year` integer NOT NULL,
	`last` integer NOT NULL,
	PRIMARY KEY(`prefix`, `year`)
);
--> statement-breakpoint
CREATE TABLE `document_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`body` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_notes_document_idx` ON `document_notes` (`document_id`);--> statement-breakpoint
CREATE TABLE `document_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`related_document_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_relations_unique_idx` ON `document_relations` (`document_id`,`related_document_id`,`kind`);--> statement-breakpoint
CREATE INDEX `document_relations_related_idx` ON `document_relations` (`related_document_id`);--> statement-breakpoint
CREATE TABLE `document_snippets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subject` text,
	`body` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_snippets_name_idx` ON `document_snippets` (`name`);--> statement-breakpoint
ALTER TABLE `documents` ADD `sent_at` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `sent_via` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `sent_note` text;