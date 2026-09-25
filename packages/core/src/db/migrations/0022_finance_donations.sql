CREATE TABLE `finance_confirmation_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`confirmation_id` text NOT NULL,
	`line_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`released_at` text,
	FOREIGN KEY (`confirmation_id`) REFERENCES `finance_confirmations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`line_id`) REFERENCES `finance_allocation_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_confirmation_lines_line_idx` ON `finance_confirmation_lines` (`line_id`) WHERE "finance_confirmation_lines"."released_at" is null;--> statement-breakpoint
CREATE INDEX `finance_confirmation_lines_confirmation_idx` ON `finance_confirmation_lines` (`confirmation_id`);--> statement-breakpoint
CREATE INDEX `finance_confirmation_lines_all_line_idx` ON `finance_confirmation_lines` (`line_id`);--> statement-breakpoint
CREATE TABLE `finance_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`contact_id` text NOT NULL,
	`notice_id` text NOT NULL,
	`document_id` text NOT NULL,
	`document_number` text NOT NULL,
	`issued_on` text NOT NULL,
	`issued_by_user_id` text NOT NULL,
	`issued_channel` text NOT NULL,
	`machine` integer DEFAULT false NOT NULL,
	`signer_id` text,
	`facsimile_checksum` text,
	`expense_waiver` integer DEFAULT false NOT NULL,
	`total_cents` integer NOT NULL,
	`period_from` text,
	`period_to` text,
	`pre_notice_reason` text,
	`signed_document_id` text,
	`sent_at` text,
	`sent_via` text,
	`voided_at` text,
	`voided_by_user_id` text,
	`void_note` text,
	`sent_before_void` integer,
	`original_returned_on` text,
	`tax_office_informed_on` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`notice_id`) REFERENCES `finance_notices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signer_id`) REFERENCES `finance_signers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_confirmations_contact_idx` ON `finance_confirmations` (`contact_id`);--> statement-breakpoint
CREATE INDEX `finance_confirmations_notice_idx` ON `finance_confirmations` (`notice_id`);--> statement-breakpoint
CREATE INDEX `finance_confirmations_document_idx` ON `finance_confirmations` (`document_id`);--> statement-breakpoint
CREATE INDEX `finance_confirmations_issued_idx` ON `finance_confirmations` (`issued_on`);--> statement-breakpoint
CREATE TABLE `finance_in_kind_details` (
	`line_id` text PRIMARY KEY NOT NULL,
	`item` text NOT NULL,
	`condition` text NOT NULL,
	`valuation` text NOT NULL,
	`origin` text NOT NULL,
	`withdrawal_value_cents` integer,
	`vat_cents` integer,
	`proof_document_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `finance_allocation_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`tax_office` text NOT NULL,
	`tax_number` text NOT NULL,
	`notice_date` text NOT NULL,
	`assessment_period` text,
	`purposes_text` text NOT NULL,
	`document_id` text,
	`superseded_on` text,
	`superseded_document_id` text,
	`voided_at` text,
	`voided_by_user_id` text,
	`void_note` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_notices_date_idx` ON `finance_notices` (`notice_date`);--> statement-breakpoint
CREATE TABLE `finance_signers` (
	`id` text PRIMARY KEY NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`signer_name` text NOT NULL,
	`facsimile_key` text,
	`facsimile_checksum` text,
	`notified_on` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_signers_valid_from_idx` ON `finance_signers` (`valid_from`);--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Spenden (F6a):
--   Bescheid         nie gelöscht; „aufgehoben oder ersetzt am“ und „irrtümlich erfasst“ je einmal
--   Unterzeichner    nie gelöscht (ein Amtsende ist valid_to)
--   Bestätigung      nie gelöscht; nach dem Ausstellen nur Versand, unterschriebene Fassung
--                    (leer → Wert), Rücknahme mit Rückholspur (einmal)
--   Bestätigungszeile nie gelöscht; nur released_at, leer → Wert
-- Keine Fremdschlüssel auf Kontakte und Dokumente: die gehören anderen Modulen.
CREATE TRIGGER finance_notices_no_delete BEFORE DELETE ON finance_notices
BEGIN
  SELECT RAISE(ABORT, 'a finance notice is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_notices_supersede_once BEFORE UPDATE OF superseded_on, superseded_document_id ON finance_notices
WHEN OLD.superseded_on IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance notice is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_notices_void_once BEFORE UPDATE OF voided_at, voided_by_user_id, void_note ON finance_notices
WHEN OLD.voided_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance notice is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_signers_no_delete BEFORE DELETE ON finance_signers
BEGIN
  SELECT RAISE(ABORT, 'a finance signer is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_no_delete BEFORE DELETE ON finance_confirmations
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_immutable BEFORE UPDATE OF id, kind, contact_id, notice_id, document_id, document_number, issued_on, issued_by_user_id, issued_channel, machine, signer_id, facsimile_checksum, expense_waiver, total_cents, period_from, period_to, pre_notice_reason, created_at ON finance_confirmations
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_void_once BEFORE UPDATE OF voided_at, voided_by_user_id, void_note, sent_before_void ON finance_confirmations
WHEN OLD.voided_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_trail_once BEFORE UPDATE OF original_returned_on, tax_office_informed_on ON finance_confirmations
WHEN (OLD.original_returned_on IS NOT NULL AND NEW.original_returned_on IS NOT OLD.original_returned_on)
  OR (OLD.tax_office_informed_on IS NOT NULL AND NEW.tax_office_informed_on IS NOT OLD.tax_office_informed_on)
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmations_signed_once BEFORE UPDATE OF signed_document_id ON finance_confirmations
WHEN OLD.signed_document_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_lines_no_delete BEFORE DELETE ON finance_confirmation_lines
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation line is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_confirmation_lines_release_once BEFORE UPDATE ON finance_confirmation_lines
WHEN NEW.id IS NOT OLD.id OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.line_id IS NOT OLD.line_id OR NEW.amount_cents IS NOT OLD.amount_cents OR OLD.released_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation line is permanent');
END;
