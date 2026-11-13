-- Custom SQL migration file, put your code below! --
-- Fassung 0.5.2. Daten (B6): Ein als „eigene Zahlung“ übernommener Kandidat trug den Dublettenschlüssel mit dem
-- Zusatz „#own“. Ein späterer Auszug desselben Zeitraums fand die Zeile daran nicht wieder und nahm sie ein zweites
-- Mal herein. Der Schlüssel ohne Zusatz ist der eigene der Zeile. Der Rohumsatz ist sonst unveränderlich; die Sperre
-- fällt nur für diesen einen Schritt und steht danach wortgleich wieder.
DROP TRIGGER finance_raw_transactions_no_update;
--> statement-breakpoint
UPDATE finance_raw_transactions SET dedup_key = substr(dedup_key, 1, length(dedup_key) - 4) WHERE dedup_key LIKE '%#own';
--> statement-breakpoint
CREATE TRIGGER finance_raw_transactions_no_update BEFORE UPDATE OF id, run_id, account_id, booking_date, value_date, amount_cents, counterparty_name, counterparty_iban, counterparty_email, purpose, bank_reference, end_to_end_id, return_code, mandate_reference, creditor_id, related_reference, dedup_key, line_index, created_at ON finance_raw_transactions
BEGIN
  SELECT RAISE(ABORT, 'a raw transaction is a permanent record');
END;

--> statement-breakpoint
CREATE TABLE `finance_tax_amendment_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_period_id` text NOT NULL,
	`kind` text NOT NULL,
	`checked_on` text NOT NULL,
	`figures` text,
	`reason` text,
	`document_id` text,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL,
	FOREIGN KEY (`tax_period_id`) REFERENCES `finance_tax_periods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_tax_amendment_checks_period_idx` ON `finance_tax_amendment_checks` (`tax_period_id`);--> statement-breakpoint
CREATE TABLE `finance_tax_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_period_id` text NOT NULL,
	`filed_on` text NOT NULL,
	`figures` text NOT NULL,
	`report_id` text NOT NULL,
	`filed_return_document_id` text,
	`transmission_protocol_document_id` text,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL,
	FOREIGN KEY (`tax_period_id`) REFERENCES `finance_tax_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `finance_reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_tax_amendments_period_idx` ON `finance_tax_amendments` (`tax_period_id`);--> statement-breakpoint
ALTER TABLE `finance_tax_periods` ADD `filed_figures` text;--> statement-breakpoint
-- B9 (0.5.2): Berichtigung und Prüfung der Steuererklärung sind Rechenschaft gegenüber dem Finanzamt (§ 147 AO,
-- Prinzip 3). An der Berichtigung ändern sich nur der Tag und die Ablage, an der Anzeige nur Tag und Schreiben; eine
-- Prüfung ohne Berichtigung bleibt, wie sie ist.
CREATE TRIGGER finance_tax_amendments_no_delete BEFORE DELETE ON finance_tax_amendments
BEGIN
  SELECT RAISE(ABORT, 'a tax return amendment is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_tax_amendments_no_update BEFORE UPDATE OF id, tax_period_id, figures, report_id, at, by_user_id ON finance_tax_amendments
BEGIN
  SELECT RAISE(ABORT, 'a tax return amendment is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_tax_amendment_checks_no_delete BEFORE DELETE ON finance_tax_amendment_checks
BEGIN
  SELECT RAISE(ABORT, 'a tax return check is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_tax_amendment_checks_no_update BEFORE UPDATE ON finance_tax_amendment_checks
WHEN OLD.kind <> 'notified' OR NEW.id IS NOT OLD.id OR NEW.tax_period_id IS NOT OLD.tax_period_id OR NEW.kind IS NOT OLD.kind OR NEW.figures IS NOT OLD.figures OR NEW.reason IS NOT OLD.reason OR NEW.at IS NOT OLD.at OR NEW.by_user_id IS NOT OLD.by_user_id
BEGIN
  SELECT RAISE(ABORT, 'a tax return check is a permanent record');
END;
--> statement-breakpoint
-- B10, Zahlung zuordnen: Spalten für die nachträgliche Zuordnung, Paar-Index nur über lebende Ausgleiche.
DROP INDEX `finance_open_item_settlements_pair_idx`;--> statement-breakpoint
ALTER TABLE `finance_open_item_settlements` ADD `assigned_at` text;--> statement-breakpoint
ALTER TABLE `finance_open_item_settlements` ADD `assigned_by_user_id` text;--> statement-breakpoint
ALTER TABLE `finance_open_item_settlements` ADD `released_at` text;--> statement-breakpoint
ALTER TABLE `finance_open_item_settlements` ADD `released_by_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `finance_open_item_settlements_pair_idx` ON `finance_open_item_settlements` (`money_line_id`,`open_item_id`) WHERE released_at is null;--> statement-breakpoint
-- Von Hand angefügt (Wächter: tests/migrations.test.ts). B10, Zahlung zuordnen: An einer festgeschriebenen Geldzeile
-- darf eine nachträgliche Zuordnung entstehen (`assigned_at` gesetzt, kein Rück-Ausgleich) und einmal aufgehoben
-- werden (`released_at` von leer auf gesetzt). Alles andere bleibt so fest wie die Buchung (Spec Zahlung zuordnen § 3.1).
DROP TRIGGER finance_open_item_settlements_final_no_insert;
--> statement-breakpoint
DROP TRIGGER finance_open_item_settlements_final_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_open_item_settlements_final_no_insert BEFORE INSERT ON finance_open_item_settlements
WHEN (SELECT e.status FROM finance_entries e JOIN finance_money_lines m ON m.entry_id = e.id WHERE m.id = NEW.money_line_id) = 'final'
  AND NOT (NEW.assigned_at IS NOT NULL AND NEW.reverses_settlement_id IS NULL AND NEW.released_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_open_item_settlements_final_no_update BEFORE UPDATE ON finance_open_item_settlements
WHEN (SELECT e.status FROM finance_entries e JOIN finance_money_lines m ON m.entry_id = e.id WHERE m.id = OLD.money_line_id) = 'final'
  AND NOT (OLD.assigned_at IS NOT NULL AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
    AND NEW.id IS OLD.id AND NEW.money_line_id IS OLD.money_line_id AND NEW.open_item_id IS OLD.open_item_id
    AND NEW.amount_cents IS OLD.amount_cents AND NEW.reverses_settlement_id IS OLD.reverses_settlement_id
    AND NEW.assigned_at IS OLD.assigned_at AND NEW.assigned_by_user_id IS OLD.assigned_by_user_id)
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_open_item_settlements_release_once BEFORE UPDATE ON finance_open_item_settlements
WHEN NEW.id IS NOT OLD.id OR NEW.money_line_id IS NOT OLD.money_line_id OR NEW.open_item_id IS NOT OLD.open_item_id
  OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.reverses_settlement_id IS NOT OLD.reverses_settlement_id
  OR NEW.assigned_at IS NOT OLD.assigned_at OR NEW.assigned_by_user_id IS NOT OLD.assigned_by_user_id
  OR OLD.released_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance settlement is permanent, it is only released once');
END;
