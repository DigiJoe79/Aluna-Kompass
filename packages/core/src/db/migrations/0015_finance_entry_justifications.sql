CREATE TABLE `finance_entry_justifications` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`by_user_id` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
