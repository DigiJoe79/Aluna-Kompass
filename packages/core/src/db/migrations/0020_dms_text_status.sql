ALTER TABLE `documents` ADD `text_status` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `text_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `text_error` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `text_extracted_at` text;--> statement-breakpoint
CREATE INDEX `documents_text_status_idx` ON `documents` (`text_status`);