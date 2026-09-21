CREATE TABLE `finance_allocation_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`line_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`state` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`note` text NOT NULL,
	`proof_document_id` text,
	`section_153` integer DEFAULT false NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`requested_at` text NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`rejected_by_user_id` text,
	`rejected_at` text,
	`reject_note` text,
	FOREIGN KEY (`line_id`) REFERENCES `finance_allocation_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_allocation_corrections_line_idx` ON `finance_allocation_corrections` (`line_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_corrections_entry_idx` ON `finance_allocation_corrections` (`entry_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_corrections_state_idx` ON `finance_allocation_corrections` (`state`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Eine Zuordnungskorrektur ist der
-- Fachdatensatz zu E18: nie gelöscht, ihr Antrag (wer, was, vorher/nachher,
-- Notiz) unveränderlich — nur der Zustand und die Freigabe-/Ablehnungsspalten
-- wandern von `pending` zu `applied` oder `rejected`.
CREATE TRIGGER finance_allocation_corrections_no_delete BEFORE DELETE ON finance_allocation_corrections
BEGIN
  SELECT RAISE(ABORT, 'finance correction is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_corrections_request_immutable BEFORE UPDATE OF line_id, entry_id, before, after, note, requested_by_user_id, requested_at ON finance_allocation_corrections
BEGIN
  SELECT RAISE(ABORT, 'finance correction is permanent');
END;