CREATE TABLE `finance_project_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`target_cents` integer,
	`default_purpose_id` text,
	`abroad` integer DEFAULT false NOT NULL,
	`publish_donation_status` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`default_purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);
