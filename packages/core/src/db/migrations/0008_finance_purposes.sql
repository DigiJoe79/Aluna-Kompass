CREATE TABLE `finance_purposes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_id` text,
	`reference_note` text,
	`target_cents` integer,
	`abroad` integer DEFAULT false NOT NULL,
	`carry_forward_cents` integer,
	`carry_forward_date` text,
	`fulfilled_at` text,
	`fulfilled_by_user_id` text,
	`dissolved_at` text,
	`dissolved_by_user_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_purposes_project_idx` ON `finance_purposes` (`project_id`);