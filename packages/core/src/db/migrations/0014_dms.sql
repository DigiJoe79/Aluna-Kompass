CREATE TABLE `document_folders` (
	`path` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_links_unique_idx` ON `document_links` (`document_id`,`entity_type`,`entity_id`,`role`);--> statement-breakpoint
CREATE INDEX `document_links_entity_idx` ON `document_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `document_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`match_field` text NOT NULL,
	`match_contains` text NOT NULL,
	`then_type_key` text,
	`then_folder` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`then_type_key`) REFERENCES `document_types`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_rules_sort_idx` ON `document_rules` (`sort_order`);--> statement-breakpoint
CREATE TABLE `document_types` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`prefix` text NOT NULL,
	`default_direction` text NOT NULL,
	`retention_class` text NOT NULL,
	`default_folder` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`template_key` text,
	`number` text,
	`entity_type` text,
	`entity_id` text,
	`input_snapshot` text,
	`asset_id` text,
	`status` text DEFAULT 'issued' NOT NULL,
	`voided_at` text,
	`voided_by_user_id` text,
	`void_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "template_key", "number", "entity_type", "entity_id", "input_snapshot", "asset_id", "status", "voided_at", "voided_by_user_id", "void_reason", "created_by_user_id", "created_at") SELECT "id", "template_key", "number", "entity_type", "entity_id", "input_snapshot", "asset_id", "status", "voided_at", "voided_by_user_id", "void_reason", "created_by_user_id", "created_at" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_number_idx` ON `documents` (`number`);