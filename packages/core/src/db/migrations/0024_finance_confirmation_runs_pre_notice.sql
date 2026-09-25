ALTER TABLE `finance_confirmation_runs` ADD `pre_notice_reason` text;--> statement-breakpoint
-- Von Hand angefügt (Wächter: tests/migrations.test.ts): Die Begründung vor dem
-- ältesten Bescheid gehört zu den Parametern des Starts und bleibt unveränderlich.
DROP TRIGGER finance_confirmation_runs_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_runs_immutable BEFORE UPDATE ON finance_confirmation_runs
WHEN NEW.id IS NOT OLD.id OR NEW.year IS NOT OLD.year OR NEW.min_cents IS NOT OLD.min_cents OR NEW.excluded_contact_ids IS NOT OLD.excluded_contact_ids
  OR NEW.follow_up_of_run_id IS NOT OLD.follow_up_of_run_id OR NEW.started_on IS NOT OLD.started_on OR NEW.started_at IS NOT OLD.started_at
  OR NEW.started_by_user_id IS NOT OLD.started_by_user_id OR NEW.started_channel IS NOT OLD.started_channel OR NEW.created_at IS NOT OLD.created_at
  OR NEW.pre_notice_reason IS NOT OLD.pre_notice_reason
  OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at)
  OR (OLD.dispatched_via IS NOT NULL AND NEW.dispatched_via IS NOT OLD.dispatched_via)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation run is permanent');
END;
