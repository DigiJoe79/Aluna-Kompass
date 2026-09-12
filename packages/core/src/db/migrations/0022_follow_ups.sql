CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`due_at` text NOT NULL,
	`title` text NOT NULL,
	`assignee_user_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`done_at` text,
	`done_by_user_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `follow_ups_entity_idx` ON `follow_ups` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `follow_ups_due_idx` ON `follow_ups` (`done_at`,`due_at`);