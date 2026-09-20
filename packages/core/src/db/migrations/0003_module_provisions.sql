CREATE TABLE `module_provisions_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`message` text NOT NULL,
	`at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE TABLE `module_provisions` (
	`module` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`outcome` text NOT NULL,
	`provisioned_at` text NOT NULL,
	PRIMARY KEY(`module`, `kind`, `key`)
);
--> statement-breakpoint
ALTER TABLE `roles` ADD `origin_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `roles_origin_key_idx` ON `roles` (`origin_key`);