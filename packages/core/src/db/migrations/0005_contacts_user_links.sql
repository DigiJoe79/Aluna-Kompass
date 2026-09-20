CREATE TABLE `contacts_user_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`linked_by_user_id` text NOT NULL,
	`unlinked_at` text,
	`unlinked_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_links_open_user_idx` ON `contacts_user_links` (`user_id`) WHERE "contacts_user_links"."unlinked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_links_open_contact_idx` ON `contacts_user_links` (`contact_id`) WHERE "contacts_user_links"."unlinked_at" is null;