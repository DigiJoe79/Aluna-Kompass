CREATE TABLE `finance_confirmation_run_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`in_kind_line_id` text,
	`line_ids` text NOT NULL,
	`total_cents` integer NOT NULL,
	`needs_signature` integer NOT NULL,
	`state` text NOT NULL,
	`confirmation_id` text,
	`error_code` text,
	`done_at` text,
	`sort_key` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `finance_confirmation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_confirmation_run_items_key_idx` ON `finance_confirmation_run_items` (`run_id`,`contact_id`,`kind`,`in_kind_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_confirmation_run_items_collective_idx` ON `finance_confirmation_run_items` (`run_id`,`contact_id`,`kind`) WHERE "finance_confirmation_run_items"."in_kind_line_id" is null;--> statement-breakpoint
CREATE TABLE `finance_confirmation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`min_cents` integer NOT NULL,
	`excluded_contact_ids` text NOT NULL,
	`follow_up_of_run_id` text,
	`started_on` text NOT NULL,
	`started_at` text NOT NULL,
	`started_by_user_id` text NOT NULL,
	`started_channel` text NOT NULL,
	`finished_at` text,
	`dispatched_at` text,
	`dispatched_via` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`follow_up_of_run_id`) REFERENCES `finance_confirmation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Serienlauf (F6b):
--   Lauf    nie gelöscht; Parameter und Start unveränderlich; finished_at,
--           dispatched_at, dispatched_via je einmal von leer auf Wert
--   Posten  nie gelöscht; der Schnappschuss unveränderlich; state,
--           confirmation_id, error_code, done_at verlassen 'pending' einmal
-- Keine Fremdschlüssel auf Kontakte und Bestätigungen am Posten: Kontakte gehören
-- einem anderen Modul, die Bestätigung kommt erst mit dem Ausgang.
CREATE TRIGGER finance_confirmation_runs_no_delete BEFORE DELETE ON finance_confirmation_runs
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_runs_immutable BEFORE UPDATE ON finance_confirmation_runs
WHEN NEW.id IS NOT OLD.id OR NEW.year IS NOT OLD.year OR NEW.min_cents IS NOT OLD.min_cents OR NEW.excluded_contact_ids IS NOT OLD.excluded_contact_ids
  OR NEW.follow_up_of_run_id IS NOT OLD.follow_up_of_run_id OR NEW.started_on IS NOT OLD.started_on OR NEW.started_at IS NOT OLD.started_at
  OR NEW.started_by_user_id IS NOT OLD.started_by_user_id OR NEW.started_channel IS NOT OLD.started_channel OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at)
  OR (OLD.dispatched_via IS NOT NULL AND NEW.dispatched_via IS NOT OLD.dispatched_via)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_run_items_no_delete BEFORE DELETE ON finance_confirmation_run_items
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run item is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_run_items_done_once BEFORE UPDATE ON finance_confirmation_run_items
WHEN NEW.id IS NOT OLD.id OR NEW.run_id IS NOT OLD.run_id OR NEW.contact_id IS NOT OLD.contact_id OR NEW.kind IS NOT OLD.kind
  OR NEW.in_kind_line_id IS NOT OLD.in_kind_line_id OR NEW.line_ids IS NOT OLD.line_ids OR NEW.total_cents IS NOT OLD.total_cents
  OR NEW.needs_signature IS NOT OLD.needs_signature OR NEW.sort_key IS NOT OLD.sort_key
  OR (OLD.state <> 'pending' AND (NEW.state IS NOT OLD.state OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.error_code IS NOT OLD.error_code OR NEW.done_at IS NOT OLD.done_at))
  OR (OLD.confirmation_id IS NOT NULL AND NEW.confirmation_id IS NOT OLD.confirmation_id)
  OR (OLD.error_code IS NOT NULL AND NEW.error_code IS NOT OLD.error_code)
  OR (OLD.done_at IS NOT NULL AND NEW.done_at IS NOT OLD.done_at)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run item is permanent');
END;
