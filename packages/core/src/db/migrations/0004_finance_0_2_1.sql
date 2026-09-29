-- Fassung 0.2.1: die Entwicklungsmigrationen 0004_flimsy_mac_gargan bis 0006_finance_no_delete_triggers,
-- unverändert in ihrer Reihenfolge verkettet (nicht neu erzeugt), damit Daten-
-- und Trigger-Umbauten auf Bestandsdaten genauso wirken wie in der alten Reihe.
-- Quelle: 0004_flimsy_mac_gargan.sql
ALTER TABLE `finance_allocation_corrections` ADD `purpose_negative_reason` text;
--> statement-breakpoint
-- Quelle: 0005_handy_calypso.sql
CREATE UNIQUE INDEX `finance_open_items_document_active_idx` ON `finance_open_items` (`document_id`) WHERE "finance_open_items"."document_id" is not null and "finance_open_items"."cancelled_at" is null;
--> statement-breakpoint
-- Quelle: 0006_finance_no_delete_triggers.sql
-- 0.2.1 (Befund 4 / A5): Löschsperren für das, was das Manifest als deletable:false führt und bisher nur der Dienst schützte.
CREATE TRIGGER finance_fiscal_years_no_delete BEFORE DELETE ON finance_fiscal_years
BEGIN
  SELECT RAISE(ABORT, 'a fiscal year is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_period_events_no_delete BEFORE DELETE ON finance_period_events
BEGIN
  SELECT RAISE(ABORT, 'a period event is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_open_items_no_delete BEFORE DELETE ON finance_open_items
BEGIN
  SELECT RAISE(ABORT, 'an open item is permanent; a mistake is cancelled');
END;
--> statement-breakpoint
CREATE TRIGGER finance_entry_justifications_no_delete BEFORE DELETE ON finance_entry_justifications
BEGIN
  SELECT RAISE(ABORT, 'an entry justification is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_not_return_marks_no_delete BEFORE DELETE ON finance_not_return_marks
BEGIN
  SELECT RAISE(ABORT, 'a not-return mark is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_partner_notices_no_delete BEFORE DELETE ON finance_partner_notices
BEGIN
  SELECT RAISE(ABORT, 'a partner notice is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_in_kind_details_final_no_delete BEFORE DELETE ON finance_in_kind_details
WHEN (SELECT e.status FROM finance_entries e JOIN finance_allocation_lines l ON l.entry_id = e.id WHERE l.id = OLD.line_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'in-kind details of a finalized line are permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_candidates_booked_no_delete BEFORE DELETE ON finance_import_candidates
WHEN OLD.raw_transaction_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM finance_money_lines ml JOIN finance_entries e ON e.id = ml.entry_id
  WHERE ml.raw_transaction_id = OLD.raw_transaction_id AND e.status = 'final'
)
BEGIN
  SELECT RAISE(ABORT, 'an import candidate of a booked transaction is permanent');
END;
