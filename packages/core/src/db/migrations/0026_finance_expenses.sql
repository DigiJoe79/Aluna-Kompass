CREATE TABLE `finance_contact_waiver_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`basis_text` text NOT NULL,
	`agreed_on` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_contact_waiver_terms_contact_idx` ON `finance_contact_waiver_terms` (`contact_id`);--> statement-breakpoint
CREATE TABLE `finance_expense_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text,
	`contact_id` text NOT NULL,
	`submitted_by_user_id` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`iban` text,
	`waiver` integer DEFAULT false NOT NULL,
	`recurring` integer DEFAULT false NOT NULL,
	`waiver_basis_text` text,
	`waiver_agreed_on` text,
	`waiver_declared_on` text,
	`waiver_declaration_document_id` text,
	`waiver_signed_document_id` text,
	`claim_agreed_confirmed` integer DEFAULT false NOT NULL,
	`waiver_late_reason` text,
	`waiver_free_funds_cents` integer,
	`submitted_at` text,
	`approved_at` text,
	`approved_by_user_id` text,
	`rejected_at` text,
	`rejected_by_user_id` text,
	`reject_note` text,
	`open_item_id` text,
	`entry_id` text,
	`copied_from_claim_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`open_item_id`) REFERENCES `finance_open_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`copied_from_claim_id`) REFERENCES `finance_expense_claims`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_expense_claims_number_idx` ON `finance_expense_claims` (`number`);--> statement-breakpoint
CREATE INDEX `finance_expense_claims_contact_idx` ON `finance_expense_claims` (`contact_id`);--> statement-breakpoint
CREATE INDEX `finance_expense_claims_state_idx` ON `finance_expense_claims` (`state`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `finance_expense_counters` (
	`year` integer PRIMARY KEY NOT NULL,
	`last` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_expense_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`kind` text NOT NULL,
	`position_date` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`project_id` text,
	`document_id` text,
	`document_number` text,
	`trip_from` text,
	`trip_to` text,
	`trip_reason` text,
	`trip_km` integer,
	`trip_rate_cents_per_km` integer,
	`category_id` text,
	`purpose_id` text,
	FOREIGN KEY (`claim_id`) REFERENCES `finance_expense_claims`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purpose_id`) REFERENCES `finance_purposes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_expense_positions_claim_idx` ON `finance_expense_positions` (`claim_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `finance_expense_positions_project_idx` ON `finance_expense_positions` (`project_id`);--> statement-breakpoint
CREATE INDEX `finance_expense_positions_document_idx` ON `finance_expense_positions` (`document_id`);--> statement-breakpoint
-- Von Hand angefügt (F8a Task 1): Ein Antrag ist ab dem Einreichen Rechenschaft — gelöscht wird nur ein Entwurf.
CREATE TRIGGER finance_expense_claims_no_delete_submitted BEFORE DELETE ON finance_expense_claims
WHEN OLD.state <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a submitted expense claim is permanent');
END;
--> statement-breakpoint
-- Ein Entwurf verlässt den Entwurf nur durch das Einreichen.
CREATE TRIGGER finance_expense_claims_draft_only_submits BEFORE UPDATE OF state ON finance_expense_claims
WHEN OLD.state = 'draft' AND NEW.state NOT IN ('draft', 'submitted')
BEGIN
  SELECT RAISE(ABORT, 'a draft expense claim moves only to submitted');
END;
--> statement-breakpoint
-- Nach dem Einreichen: was eingereicht wurde, bleibt; `state` verlässt `submitted` genau einmal, die Freigabefelder
-- ändern sich nur bis dahin. Danach nur noch die unterschriebene Verzichtserklärung (einmal) und das Leeren einer
-- Dokument-ID, wenn das Dokument nach seiner Frist gelöscht wird (Grabstein).
CREATE TRIGGER finance_expense_claims_submitted_immutable BEFORE UPDATE ON finance_expense_claims
WHEN OLD.state <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.number IS NOT OLD.number OR NEW.contact_id IS NOT OLD.contact_id OR NEW.submitted_by_user_id IS NOT OLD.submitted_by_user_id
  OR NEW.iban IS NOT OLD.iban OR NEW.waiver IS NOT OLD.waiver OR NEW.recurring IS NOT OLD.recurring OR NEW.waiver_basis_text IS NOT OLD.waiver_basis_text
  OR NEW.waiver_agreed_on IS NOT OLD.waiver_agreed_on OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.copied_from_claim_id IS NOT OLD.copied_from_claim_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
    OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.reject_note IS NOT OLD.reject_note
    OR NEW.open_item_id IS NOT OLD.open_item_id OR NEW.entry_id IS NOT OLD.entry_id OR NEW.claim_agreed_confirmed IS NOT OLD.claim_agreed_confirmed
    OR NEW.waiver_late_reason IS NOT OLD.waiver_late_reason OR NEW.waiver_free_funds_cents IS NOT OLD.waiver_free_funds_cents
    OR NEW.waiver_declared_on IS NOT OLD.waiver_declared_on
    OR (NEW.waiver_declaration_document_id IS NOT OLD.waiver_declaration_document_id AND NEW.waiver_declaration_document_id IS NOT NULL)
  ))
  OR (OLD.waiver_signed_document_id IS NOT NULL AND NEW.waiver_signed_document_id IS NOT NULL AND NEW.waiver_signed_document_id IS NOT OLD.waiver_signed_document_id)
)
BEGIN
  SELECT RAISE(ABORT, 'a submitted expense claim is permanent');
END;
--> statement-breakpoint
-- Positionen: nach dem Einreichen nur Kategorie und Zweck, solange der Antrag eingereicht ist; das Dokument höchstens geleert.
CREATE TRIGGER finance_expense_positions_immutable_after_submit BEFORE UPDATE ON finance_expense_positions
WHEN (SELECT state FROM finance_expense_claims WHERE id = OLD.claim_id) <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.claim_id IS NOT OLD.claim_id OR NEW.sort_order IS NOT OLD.sort_order OR NEW.kind IS NOT OLD.kind
  OR NEW.position_date IS NOT OLD.position_date OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.purpose IS NOT OLD.purpose OR NEW.project_id IS NOT OLD.project_id
  OR NEW.document_number IS NOT OLD.document_number OR NEW.trip_from IS NOT OLD.trip_from OR NEW.trip_to IS NOT OLD.trip_to OR NEW.trip_reason IS NOT OLD.trip_reason
  OR NEW.trip_km IS NOT OLD.trip_km OR NEW.trip_rate_cents_per_km IS NOT OLD.trip_rate_cents_per_km
  OR (NEW.document_id IS NOT OLD.document_id AND NEW.document_id IS NOT NULL)
  OR ((SELECT state FROM finance_expense_claims WHERE id = OLD.claim_id) <> 'submitted' AND (NEW.category_id IS NOT OLD.category_id OR NEW.purpose_id IS NOT OLD.purpose_id))
)
BEGIN
  SELECT RAISE(ABORT, 'a position of a submitted expense claim is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_expense_positions_no_insert_after_submit BEFORE INSERT ON finance_expense_positions
WHEN (SELECT state FROM finance_expense_claims WHERE id = NEW.claim_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a submitted expense claim is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_expense_positions_no_delete_after_submit BEFORE DELETE ON finance_expense_positions
WHEN (SELECT state FROM finance_expense_claims WHERE id = OLD.claim_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a position of a submitted expense claim is permanent');
END;
