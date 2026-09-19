CREATE TABLE `document_former_numbers` (
	`document_id` text NOT NULL,
	`number` text NOT NULL,
	`replaced_at` text NOT NULL,
	PRIMARY KEY(`document_id`, `number`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_former_numbers_number_idx` ON `document_former_numbers` (`number`);