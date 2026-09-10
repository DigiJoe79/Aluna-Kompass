CREATE TABLE `contact_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`label` text,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contact_channels_contact_idx` ON `contact_channels` (`contact_id`);--> statement-breakpoint
CREATE TABLE `contact_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`role` text NOT NULL,
	`since` text NOT NULL,
	`until` text,
	`note` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contact_roles_contact_idx` ON `contact_roles` (`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_roles_role_idx` ON `contact_roles` (`role`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`salutation` text,
	`first_name` text,
	`last_name` text,
	`name` text,
	`legal_form` text,
	`belongs_to_id` text,
	`address_extra` text,
	`street` text,
	`postal_code` text,
	`city` text,
	`country` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`belongs_to_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_status_idx` ON `contacts` (`status`);--> statement-breakpoint
CREATE INDEX `contacts_belongs_to_idx` ON `contacts` (`belongs_to_id`);