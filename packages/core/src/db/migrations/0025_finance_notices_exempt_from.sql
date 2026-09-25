-- Von db:generate kam `ALTER TABLE finance_notices ADD exempt_from text NOT NULL` —
-- SQLite lehnt eine NOT-NULL-Spalte ohne Vorgabe ab. Ein Neuaufbau der Tabelle
-- scheitert auf gefüllten Datenbanken: Der Migrator läuft in einer Transaktion,
-- `PRAGMA foreign_keys = OFF` ist dort wirkungslos, und das DROP TABLE verletzt
-- die Verweise aus finance_confirmations. Darum von Hand (Wächter:
-- tests/migrations.test.ts): die Spalte mit leerer Vorgabe nur in der Datenbank,
-- der Dienst verlangt den Wert immer. „Steuerbefreiung ab“ (BMF 07.11.2013
-- Nr. 14). Auf Test und Prod gibt es keine Bescheide; Entwicklungsdaten bekommen
-- das Bescheiddatum als Beginn (strenger als nötig, nie zu lax). Die Trigger aus
-- 0022 bleiben, weil die Tabelle bleibt.
ALTER TABLE `finance_notices` ADD `exempt_from` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `finance_notices` SET `exempt_from` = `notice_date`;--> statement-breakpoint
-- Von Hand (Wächter: tests/migrations.test.ts): Die Pflichtbegründung vor dem
-- ältesten Bescheid entfällt (BMF 07.11.2013 Nr. 14: solche Bestätigungen sind
-- unrichtig). Die Trigger nennen die Spalte — erst sie, dann die Spalte, dann
-- die Trigger neu.
DROP TRIGGER finance_confirmations_immutable;--> statement-breakpoint
ALTER TABLE `finance_confirmations` DROP COLUMN `pre_notice_reason`;--> statement-breakpoint
CREATE TRIGGER finance_confirmations_immutable BEFORE UPDATE OF id, kind, contact_id, notice_id, document_id, document_number, issued_on, issued_by_user_id, issued_channel, machine, signer_id, facsimile_checksum, expense_waiver, total_cents, period_from, period_to, created_at ON finance_confirmations
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
DROP TRIGGER finance_confirmation_runs_immutable;--> statement-breakpoint
ALTER TABLE `finance_confirmation_runs` DROP COLUMN `pre_notice_reason`;--> statement-breakpoint
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
