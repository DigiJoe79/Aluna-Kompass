PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`phase` text DEFAULT 'draft' NOT NULL,
	`direction` text DEFAULT 'outgoing' NOT NULL,
	`source_kind` text DEFAULT 'generated' NOT NULL,
	`type_key` text NOT NULL,
	`number` text,
	`subject` text DEFAULT '' NOT NULL,
	`document_date` text NOT NULL,
	`folder` text,
	`draft_body` text,
	`template_key` text,
	`input_snapshot` text,
	`asset_id` text,
	`status` text DEFAULT 'issued' NOT NULL,
	`voided_at` text,
	`voided_by_user_id` text,
	`void_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`type_key`) REFERENCES `document_types`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "phase", "direction", "source_kind", "type_key", "number", "subject", "document_date", "folder", "draft_body", "template_key", "input_snapshot", "asset_id", "status", "voided_at", "voided_by_user_id", "void_reason", "created_by_user_id", "created_at", "updated_at") SELECT "id", "phase", "direction", "source_kind", "type_key", "number", "subject", "document_date", "folder", "draft_body", "template_key", "input_snapshot", "asset_id", "status", "voided_at", "voided_by_user_id", "void_reason", "created_by_user_id", "created_at", "updated_at" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_number_idx` ON `documents` (`number`);--> statement-breakpoint
CREATE INDEX `documents_folder_idx` ON `documents` (`folder`);--> statement-breakpoint
CREATE INDEX `documents_phase_idx` ON `documents` (`phase`);