ALTER TABLE `documents` ADD `phase` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `direction` text DEFAULT 'outgoing' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_kind` text DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `type_key` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `subject` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `document_date` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `folder` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `draft_body` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `updated_at` text;--> statement-breakpoint
CREATE INDEX `documents_folder_idx` ON `documents` (`folder`);--> statement-breakpoint
CREATE INDEX `documents_phase_idx` ON `documents` (`phase`);