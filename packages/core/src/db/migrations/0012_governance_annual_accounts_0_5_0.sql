CREATE TABLE `finance_annual_accounts_notes` (
	`fiscal_year_id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_annual_accounts_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`published_at` text NOT NULL,
	`published_by_user_id` text NOT NULL,
	`early_reason` text,
	`early_note` text,
	`corrected` integer DEFAULT false NOT NULL,
	`replaces_finalized_at` text,
	`web_document_id` text,
	`web_document_number` text,
	`web_version_on` text,
	`withdrawn_at` text,
	`withdrawn_by_user_id` text,
	`withdrawn_cause` text,
	`withdrawn_live_since` text,
	FOREIGN KEY (`report_id`) REFERENCES `finance_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_annual_accounts_publications_year_idx` ON `finance_annual_accounts_publications` (`fiscal_year_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_annual_accounts_publications_live_idx` ON `finance_annual_accounts_publications` (`report_id`) WHERE "finance_annual_accounts_publications"."withdrawn_at" is null;--> statement-breakpoint
CREATE TABLE `finance_funds_use_openings` (
	`id` text PRIMARY KEY NOT NULL,
	`offset` integer NOT NULL,
	`designation` text NOT NULL,
	`ends_on` text NOT NULL,
	`revenue_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`document_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funds_use_openings_offset_idx` ON `finance_funds_use_openings` (`offset`);--> statement-breakpoint
CREATE TABLE `finance_name_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`on` text NOT NULL,
	`from_year` integer,
	`document_id` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_name_consents_contact_idx` ON `finance_name_consents` (`contact_id`,`on`);--> statement-breakpoint
CREATE TABLE `finance_report_signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`signer_name` text NOT NULL,
	`signer_office` text,
	`via` text NOT NULL,
	`signer_user_id` text,
	`signed_on` text NOT NULL,
	`document_id` text NOT NULL,
	`document_number` text NOT NULL,
	`scan_document_id` text,
	`named_contact_ids` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `finance_reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_report_signatures_report_id_unique` ON `finance_report_signatures` (`report_id`);--> statement-breakpoint
CREATE TABLE `governance_agenda_items` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`invitation_text` text,
	`proposal` text,
	`attachment_document_ids` text DEFAULT '[]' NOT NULL,
	`office_ids` text DEFAULT '[]' NOT NULL,
	`fiscal_year_id` text,
	`statute_id` text,
	`motion_id` text,
	`minutes_note` text,
	`wording_changes` text DEFAULT '[]' NOT NULL,
	`added_during` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_agenda_items_meeting_idx` ON `governance_agenda_items` (`meeting_id`,`position`);--> statement-breakpoint
CREATE TABLE `governance_assembly_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organ_id` text NOT NULL,
	`received_on` text NOT NULL,
	`supporters` integer NOT NULL,
	`purpose` text NOT NULL,
	`document_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `governance_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`contact_id` text,
	`membership_id` text,
	`guest` integer DEFAULT false NOT NULL,
	`guest_label` text,
	`role` text NOT NULL,
	`voting_right` integer NOT NULL,
	`periods` text DEFAULT '[]' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_attendance_meeting_idx` ON `governance_attendance` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `governance_attendance_contact_idx` ON `governance_attendance` (`contact_id`);--> statement-breakpoint
CREATE TABLE `governance_circular_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`circular_id` text NOT NULL,
	`contact_id` text,
	`answer` text NOT NULL,
	`answered_on` text,
	`document_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_circular_responses_circular_idx` ON `governance_circular_responses` (`circular_id`);--> statement-breakpoint
CREATE INDEX `governance_circular_responses_contact_idx` ON `governance_circular_responses` (`contact_id`);--> statement-breakpoint
CREATE TABLE `governance_circulars` (
	`id` text PRIMARY KEY NOT NULL,
	`organ_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`details` text,
	`requested_on` text NOT NULL,
	`deadline` text NOT NULL,
	`channel` text NOT NULL,
	`outcome` text,
	`outcome_reason` text,
	`decided_on` text,
	`decided_by_contact_id` text,
	`sealed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_circulars_organ_idx` ON `governance_circulars` (`organ_id`,`requested_on`);--> statement-breakpoint
CREATE TABLE `governance_invitation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`issued_on` text NOT NULL,
	`master_document_id` text,
	`refused` text DEFAULT '[]' NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `governance_invitation_runs_meeting_idx` ON `governance_invitation_runs` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `governance_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`organ_id` text NOT NULL,
	`kind` text NOT NULL,
	`held_on` text NOT NULL,
	`starts_at` text NOT NULL,
	`form` text NOT NULL,
	`place` text,
	`access` text,
	`remote_note` text,
	`planned_chair_contact_id` text,
	`planned_minute_taker_contact_id` text,
	`repeat_of_id` text,
	`assembly_request_id` text,
	`invited_on` text,
	`invitation_document_id` text,
	`invitation_note` text,
	`cancelled_on` text,
	`cancel_reason` text,
	`started_at` text,
	`started_on` text,
	`ended_at` text,
	`writer_user_id` text,
	`findings` text DEFAULT '{}' NOT NULL,
	`sealed_at` text,
	`sealed_by_user_id` text,
	`backfilled` integer DEFAULT false NOT NULL,
	`backfill_present` integer,
	`backfill_voting` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_meetings_organ_idx` ON `governance_meetings` (`organ_id`,`held_on`);--> statement-breakpoint
CREATE TABLE `governance_minutes_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`version` integer NOT NULL,
	`document_id` text NOT NULL,
	`reason` text,
	`filed_at` text NOT NULL,
	`filed_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `governance_minutes_versions_meeting_idx` ON `governance_minutes_versions` (`meeting_id`,`version`);--> statement-breakpoint
CREATE INDEX `governance_minutes_versions_document_idx` ON `governance_minutes_versions` (`document_id`);--> statement-breakpoint
CREATE TABLE `governance_motions` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`submitted_by_contact_id` text,
	`received_on` text NOT NULL,
	`text` text NOT NULL,
	`document_id` text,
	`agenda_item_id` text,
	`withdrawn_on` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_motions_meeting_idx` ON `governance_motions` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `governance_motions_contact_idx` ON `governance_motions` (`submitted_by_contact_id`);--> statement-breakpoint
CREATE TABLE `governance_offices` (
	`id` text PRIMARY KEY NOT NULL,
	`organ_id` text NOT NULL,
	`name` text NOT NULL,
	`seats` integer DEFAULT 1 NOT NULL,
	`representative` integer DEFAULT false NOT NULL,
	`term_months` integer,
	`until_successor` integer DEFAULT false NOT NULL,
	`function` text,
	`incompatible_with` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_offices_organ_idx` ON `governance_offices` (`organ_id`);--> statement-breakpoint
CREATE TABLE `governance_organs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `governance_organs_kind_idx` ON `governance_organs` (`kind`) WHERE "governance_organs"."kind" in ('assembly', 'board');--> statement-breakpoint
CREATE TABLE `governance_register_filings` (
	`id` text PRIMARY KEY NOT NULL,
	`notary_contact_id` text,
	`notarized_on` text,
	`submitted_on` text,
	`interim_orders` text DEFAULT '[]' NOT NULL,
	`registered_on` text,
	`register_court` text,
	`register_number` text,
	`extract_document_id` text,
	`documents` text DEFAULT '{}' NOT NULL,
	`transparency` text,
	`dissolution` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `governance_register_occasions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`occurred_on` text NOT NULL,
	`meeting_id` text,
	`resolution_id` text,
	`term_id` text,
	`office_id` text,
	`statute_id` text,
	`filing_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_register_occasions_filing_idx` ON `governance_register_occasions` (`filing_id`);--> statement-breakpoint
CREATE INDEX `governance_register_occasions_day_idx` ON `governance_register_occasions` (`occurred_on`);--> statement-breakpoint
CREATE TABLE `governance_resolution_counters` (
	`year` integer PRIMARY KEY NOT NULL,
	`next` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `governance_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text,
	`circular_id` text,
	`agenda_item_id` text,
	`organ_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`voted_at` text,
	`decided_on` text NOT NULL,
	`votes` text,
	`yes_computed` integer DEFAULT false NOT NULL,
	`unanimous` integer DEFAULT false NOT NULL,
	`excluded` text DEFAULT '[]' NOT NULL,
	`outcome` text,
	`outcome_reason` text,
	`details` text,
	`number` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_resolutions_meeting_idx` ON `governance_resolutions` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `governance_resolutions_organ_idx` ON `governance_resolutions` (`organ_id`,`decided_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `governance_resolutions_number_idx` ON `governance_resolutions` (`number`);--> statement-breakpoint
CREATE TABLE `governance_run_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`document_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `governance_run_letters_run_membership_idx` ON `governance_run_letters` (`run_id`,`membership_id`);--> statement-breakpoint
CREATE TABLE `governance_statutes` (
	`id` text PRIMARY KEY NOT NULL,
	`based_on_id` text,
	`document_id` text,
	`resolutions` text DEFAULT '[]' NOT NULL,
	`registered_on` text,
	`rules` text DEFAULT '{"organs":{}}' NOT NULL,
	`tax_review` text DEFAULT '{"affectsCharity":null,"submittedOn":null,"submissionDocumentId":null,"answer":null,"answerDocumentId":null}' NOT NULL,
	`founding_checks` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `governance_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`since` text NOT NULL,
	`until` text,
	`origin` text NOT NULL,
	`accepted_on` text,
	`resolution_id` text,
	`end_reason` text,
	`end_received_on` text,
	`document_id` text,
	`role_row_ids` text DEFAULT '[]' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `governance_terms_office_idx` ON `governance_terms` (`office_id`);--> statement-breakpoint
CREATE INDEX `governance_terms_contact_idx` ON `governance_terms` (`contact_id`);--> statement-breakpoint
ALTER TABLE `contact_roles` ADD `represents_association` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `finance_categories` ADD `donation_platform` text;--> statement-breakpoint
ALTER TABLE `finance_contact_tax_details` ADD `legal_entity` text;--> statement-breakpoint
ALTER TABLE `finance_partner_payments` ADD `resolution_id` text;--> statement-breakpoint
ALTER TABLE `finance_reports` ADD `finalize_confirmation` text;--> statement-breakpoint
ALTER TABLE `finance_reserves` ADD `resolution_id` text;--> statement-breakpoint
ALTER TABLE `member_fee_schedules` ADD `resolution_id` text;--> statement-breakpoint
-- Jahresrechnung (0.4.5, Ve-L-6): Die Einwilligung zur Namensnennung ist ein Verlauf — nur anhängen. Löschen geht nur,
-- wenn der Kontakt schon fort ist: Der Löschweg der Kontakte löscht erst den Kontakt, dann ruft er `recordDeleted`.
CREATE TRIGGER finance_name_consents_no_delete BEFORE DELETE ON finance_name_consents
WHEN EXISTS (SELECT 1 FROM contacts WHERE id = OLD.contact_id)
BEGIN
  SELECT RAISE(ABORT, 'a name consent is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_name_consents_immutable BEFORE UPDATE ON finance_name_consents
BEGIN
  SELECT RAISE(ABORT, 'a name consent is a permanent record');
END;
--> statement-breakpoint
-- Jahresrechnung (0.4.5, Planreview J1): Die Bestätigung beim Festschreiben gehört zur Fassung wie ihre Freigabe.
DROP TRIGGER finance_reports_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_reports_immutable BEFORE UPDATE ON finance_reports
WHEN NEW.id IS NOT OLD.id OR NEW.report_key IS NOT OLD.report_key OR NEW.params IS NOT OLD.params OR NEW.fiscal_year_id IS NOT OLD.fiscal_year_id
  OR NEW.data_hash IS NOT OLD.data_hash OR NEW.document_id IS NOT OLD.document_id OR NEW.document_number IS NOT OLD.document_number
  OR NEW.release_basis IS NOT OLD.release_basis OR NEW.finalized_at IS NOT OLD.finalized_at OR NEW.finalized_by_user_id IS NOT OLD.finalized_by_user_id
  OR NEW.finalize_confirmation IS NOT OLD.finalize_confirmation
  OR (OLD.voided_at IS NOT NULL AND (NEW.voided_at IS NOT OLD.voided_at OR NEW.void_reason IS NOT OLD.void_reason
    OR (NEW.replaced_by_report_id IS NOT OLD.replaced_by_report_id AND (OLD.replaced_by_report_id IS NOT NULL OR NEW.replaced_by_report_id IS NULL))))
BEGIN
  SELECT RAISE(ABORT, 'a finalized report is immutable');
END;
--> statement-breakpoint
-- Jahresrechnung (0.4.5, J2): Die Abzeichnung ist Nachweis, was abgezeichnet war — nur anhängen.
CREATE TRIGGER finance_report_signatures_immutable BEFORE UPDATE ON finance_report_signatures
BEGIN
  SELECT RAISE(ABORT, 'a report signature is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_report_signatures_no_delete BEFORE DELETE ON finance_report_signatures
BEGIN
  SELECT RAISE(ABORT, 'a report signature is a permanent record');
END;
--> statement-breakpoint
-- Die Veröffentlichung ist Nachweis, was wann öffentlich war: Zurücknehmen setzt `withdrawn_*` einmal, die Webfassung
-- nach Widerruf einer Einwilligung setzt `web_*` neu; alles andere bleibt, gelöscht wird nie.
CREATE TRIGGER finance_annual_accounts_publications_immutable BEFORE UPDATE ON finance_annual_accounts_publications
WHEN NEW.id IS NOT OLD.id OR NEW.report_id IS NOT OLD.report_id OR NEW.fiscal_year_id IS NOT OLD.fiscal_year_id
  OR NEW.published_at IS NOT OLD.published_at OR NEW.published_by_user_id IS NOT OLD.published_by_user_id
  OR NEW.early_reason IS NOT OLD.early_reason OR NEW.early_note IS NOT OLD.early_note OR NEW.corrected IS NOT OLD.corrected
  OR NEW.replaces_finalized_at IS NOT OLD.replaces_finalized_at
  OR (OLD.withdrawn_at IS NOT NULL AND (NEW.withdrawn_at IS NOT OLD.withdrawn_at OR NEW.withdrawn_by_user_id IS NOT OLD.withdrawn_by_user_id OR NEW.withdrawn_cause IS NOT OLD.withdrawn_cause))
BEGIN
  SELECT RAISE(ABORT, 'an annual accounts publication is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_annual_accounts_publications_no_delete BEFORE DELETE ON finance_annual_accounts_publications
BEGIN
  SELECT RAISE(ABORT, 'an annual accounts publication is a permanent record');
END;
--> statement-breakpoint
-- Mittelverwendung (0.4.5, M1): Ein Anfangsvortrag gehört zur Rechnung des ersten Jahres — er wird nie gelöscht.
CREATE TRIGGER finance_funds_use_openings_no_delete BEFORE DELETE ON finance_funds_use_openings
BEGIN
  SELECT RAISE(ABORT, 'a funds use opening is a permanent record');
END;
