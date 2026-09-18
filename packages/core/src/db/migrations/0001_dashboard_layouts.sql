CREATE TABLE `dashboard_layouts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`tiles` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
