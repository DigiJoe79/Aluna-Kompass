-- Fassung 0.4.0: die Entwicklungsmigrationen 0011_finance_reports_0_4_0 bis 0060_finance_vat_filings_update,
-- unverändert in ihrer Reihenfolge verkettet (nicht neu erzeugt), damit Daten-
-- und Trigger-Umbauten auf Bestandsdaten genauso wirken wie in der alten Reihe.
-- Quelle: 0011_finance_reports_0_4_0.sql
CREATE TABLE `finance_report_releases` (
	`fiscal_year_id` text PRIMARY KEY NOT NULL,
	`basis` text NOT NULL,
	`note` text,
	`document_id` text,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` text,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`report_key` text NOT NULL,
	`params` text NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`data_hash` text NOT NULL,
	`document_id` text NOT NULL,
	`document_number` text NOT NULL,
	`release_basis` text,
	`finalized_at` text NOT NULL,
	`finalized_by_user_id` text NOT NULL,
	`voided_at` text,
	`void_reason` text,
	`replaced_by_report_id` text,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replaced_by_report_id`) REFERENCES `finance_reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_reports_year_idx` ON `finance_reports` (`fiscal_year_id`);--> statement-breakpoint
CREATE INDEX `finance_reports_key_params_idx` ON `finance_reports` (`report_key`,`params`);
--> statement-breakpoint
-- Quelle: 0012_finance_reports_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft A1 (0.4.0): Löschsperren der Berichte (Wächter no-delete-triggers.test.ts). Eine festgeschriebene
-- Fassung wird storniert, nie gelöscht; die Freigabe eines Jahres widerrufen, nie gelöscht.
CREATE TRIGGER finance_reports_no_delete BEFORE DELETE ON finance_reports
BEGIN
  SELECT RAISE(ABORT, 'a finalized report is a permanent record');
END;
--> statement-breakpoint
-- Was festgeschrieben wurde, steht fest: nur das Storno (einmal, von leer) darf nachkommen.
CREATE TRIGGER finance_reports_immutable BEFORE UPDATE ON finance_reports
WHEN NEW.id IS NOT OLD.id OR NEW.report_key IS NOT OLD.report_key OR NEW.params IS NOT OLD.params OR NEW.fiscal_year_id IS NOT OLD.fiscal_year_id
  OR NEW.data_hash IS NOT OLD.data_hash OR NEW.document_id IS NOT OLD.document_id OR NEW.document_number IS NOT OLD.document_number
  OR NEW.release_basis IS NOT OLD.release_basis OR NEW.finalized_at IS NOT OLD.finalized_at OR NEW.finalized_by_user_id IS NOT OLD.finalized_by_user_id
  OR (OLD.voided_at IS NOT NULL AND (NEW.voided_at IS NOT OLD.voided_at OR NEW.void_reason IS NOT OLD.void_reason OR NEW.replaced_by_report_id IS NOT OLD.replaced_by_report_id))
BEGIN
  SELECT RAISE(ABORT, 'a finalized report is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_report_releases_no_delete BEFORE DELETE ON finance_report_releases
BEGIN
  SELECT RAISE(ABORT, 'a release for finalizing is revoked, never deleted');
END;

--> statement-breakpoint
-- Quelle: 0013_finance_other_assets.sql
CREATE TABLE `finance_other_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`value_cents` integer NOT NULL,
	`basis` text NOT NULL,
	`recorded_from` text NOT NULL,
	`recorded_until` text,
	`end_reason` text,
	`replaced_by_id` text,
	`document_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_other_assets_from_idx` ON `finance_other_assets` (`recorded_from`);--> statement-breakpoint
CREATE INDEX `finance_other_assets_replaced_by_idx` ON `finance_other_assets` (`replaced_by_id`);
--> statement-breakpoint
-- Quelle: 0014_finance_other_assets_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft A2 (0.4.0): Sonstiges Vermögen wird beendet, nie gelöscht (Wächter no-delete-triggers.test.ts) —
-- festgeschriebene Berichte zu einem früheren Stichtag rechnen weiter mit ihm.
CREATE TRIGGER finance_other_assets_no_delete BEFORE DELETE ON finance_other_assets
BEGIN
  SELECT RAISE(ABORT, 'an other asset is ended, never deleted');
END;

--> statement-breakpoint
-- Quelle: 0015_finance_audit_auditors.sql
CREATE TABLE `finance_audit_auditors` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`mode` text NOT NULL,
	`confidential` integer DEFAULT false NOT NULL,
	`confidentiality_document_id` text,
	`elected_on` text,
	`minutes_document_id` text,
	`access_ended_at` text,
	`access_ended_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_audit_auditors_year_contact_idx` ON `finance_audit_auditors` (`fiscal_year_id`,`contact_id`);
--> statement-breakpoint
-- Quelle: 0016_finance_audit_baselines.sql
CREATE TABLE `finance_audit_baseline_entries` (
	`baseline_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`baseline_id`, `entry_id`),
	FOREIGN KEY (`baseline_id`) REFERENCES `finance_audit_baselines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_audit_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`kind` text NOT NULL,
	`report_refs` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_audit_baselines_year_idx` ON `finance_audit_baselines` (`fiscal_year_id`,`created_at`);
--> statement-breakpoint
-- Quelle: 0017_finance_audit_baselines_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft D1 (0.4.0): Der Prüfstand ist eine Tatsache des Abschlusses — unveränderlich, nie gelöscht.
CREATE TRIGGER finance_audit_baselines_no_delete BEFORE DELETE ON finance_audit_baselines
BEGIN
  SELECT RAISE(ABORT, 'an audit baseline is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_baselines_immutable BEFORE UPDATE ON finance_audit_baselines
BEGIN
  SELECT RAISE(ABORT, 'an audit baseline is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_baseline_entries_no_delete BEFORE DELETE ON finance_audit_baseline_entries
BEGIN
  SELECT RAISE(ABORT, 'an audit baseline is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_baseline_entries_immutable BEFORE UPDATE ON finance_audit_baseline_entries
BEGIN
  SELECT RAISE(ABORT, 'an audit baseline is immutable');
END;

--> statement-breakpoint
-- Quelle: 0018_finance_audit_samples.sql
CREATE TABLE `finance_audit_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`auditor_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auditor_id`) REFERENCES `finance_audit_auditors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_audit_samples_auditor_entry_idx` ON `finance_audit_samples` (`auditor_id`,`entry_id`);--> statement-breakpoint
CREATE INDEX `finance_audit_samples_year_idx` ON `finance_audit_samples` (`fiscal_year_id`);--> statement-breakpoint
CREATE TABLE `finance_audit_section_reviews` (
	`fiscal_year_id` text NOT NULL,
	`auditor_id` text NOT NULL,
	`section` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auditor_id`) REFERENCES `finance_audit_auditors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_audit_section_reviews_idx` ON `finance_audit_section_reviews` (`fiscal_year_id`,`auditor_id`,`section`);
--> statement-breakpoint
-- Quelle: 0019_finance_audit_remarks.sql
CREATE TABLE `finance_audit_remark_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`remark_id` text NOT NULL,
	`kind` text NOT NULL,
	`by_user_id` text NOT NULL,
	`text` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`remark_id`) REFERENCES `finance_audit_remarks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_audit_remark_posts_remark_idx` ON `finance_audit_remark_posts` (`remark_id`,`at`);--> statement-breakpoint
CREATE TABLE `finance_audit_remarks` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`text` text NOT NULL,
	`author_auditor_id` text NOT NULL,
	`entered_by_user_id` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_auditor_id`) REFERENCES `finance_audit_auditors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_audit_remarks_year_idx` ON `finance_audit_remarks` (`fiscal_year_id`,`state`);--> statement-breakpoint
CREATE INDEX `finance_audit_remarks_target_idx` ON `finance_audit_remarks` (`target_type`,`target_id`);
--> statement-breakpoint
-- Quelle: 0020_finance_audit_remarks_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft D1 (0.4.0): Vermerke der Kassenprüfung werden geklärt, nie gelöscht; was geschrieben ist, bleibt.
CREATE TRIGGER finance_audit_remarks_no_delete BEFORE DELETE ON finance_audit_remarks
BEGIN
  SELECT RAISE(ABORT, 'an audit remark is a permanent record');
END;
--> statement-breakpoint
-- Nur der Zustand ändert sich (offen, beantwortet, geklärt); Art, Ziel, Text und Verfasser stehen fest.
CREATE TRIGGER finance_audit_remarks_immutable BEFORE UPDATE ON finance_audit_remarks
WHEN NEW.id IS NOT OLD.id OR NEW.fiscal_year_id IS NOT OLD.fiscal_year_id OR NEW.kind IS NOT OLD.kind OR NEW.target_type IS NOT OLD.target_type
  OR NEW.target_id IS NOT OLD.target_id OR NEW.text IS NOT OLD.text OR NEW.author_auditor_id IS NOT OLD.author_auditor_id
  OR NEW.entered_by_user_id IS NOT OLD.entered_by_user_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'an audit remark is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_remark_posts_no_delete BEFORE DELETE ON finance_audit_remark_posts
BEGIN
  SELECT RAISE(ABORT, 'an audit remark is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_remark_posts_immutable BEFORE UPDATE ON finance_audit_remark_posts
BEGIN
  SELECT RAISE(ABORT, 'an audit remark is immutable');
END;

--> statement-breakpoint
-- Quelle: 0021_finance_audit_reports.sql
CREATE TABLE `finance_audit_report_deviations` (
	`report_id` text NOT NULL,
	`auditor_id` text NOT NULL,
	`text` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`report_id`, `auditor_id`),
	FOREIGN KEY (`report_id`) REFERENCES `finance_audit_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auditor_id`) REFERENCES `finance_audit_auditors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_audit_report_results` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`auditor_id` text,
	`result` text,
	`recommendation` text DEFAULT 'none' NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `finance_audit_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auditor_id`) REFERENCES `finance_audit_auditors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_audit_report_results_report_idx` ON `finance_audit_report_results` (`report_id`);--> statement-breakpoint
CREATE TABLE `finance_audit_report_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`auditor_id` text,
	`document_id` text NOT NULL,
	`filed_at` text NOT NULL,
	`filed_by_user_id` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `finance_audit_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auditor_id`) REFERENCES `finance_audit_auditors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_audit_report_scans_report_idx` ON `finance_audit_report_scans` (`report_id`);--> statement-breakpoint
CREATE TABLE `finance_audit_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`kind` text NOT NULL,
	`origin` text NOT NULL,
	`baseline_id` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`exam_dates` text DEFAULT '[]' NOT NULL,
	`exam_place` text,
	`exam_not_tested` text,
	`exam_cash_count_id` text,
	`exam_updated_at` text,
	`exam_updated_by_user_id` text,
	`signature_mode` text DEFAULT 'both' NOT NULL,
	`non_signer_auditor_id` text,
	`non_signer_reason` text,
	`signatures_updated_at` text,
	`signatures_updated_by_user_id` text,
	`ready_at` text,
	`ready_by_user_id` text,
	`filed_at` text,
	`last_printed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`baseline_id`) REFERENCES `finance_audit_baselines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_audit_reports_year_idx` ON `finance_audit_reports` (`fiscal_year_id`,`created_at`);
--> statement-breakpoint
-- Quelle: 0022_finance_audit_reports_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft D1 (0.4.0): Ergebnis und Scan je Bericht und Prüfer genau einmal, „gemeinsam“ (leer) eingeschlossen —
-- ein Ausdrucks-Index, den das Drizzle-Schema nicht ausdrücken kann.
CREATE UNIQUE INDEX finance_audit_report_results_idx ON finance_audit_report_results (report_id, coalesce(auditor_id, ''));
--> statement-breakpoint
CREATE UNIQUE INDEX finance_audit_report_scans_idx ON finance_audit_report_scans (report_id, coalesce(auditor_id, ''));
--> statement-breakpoint
-- Der Prüfbericht ist Teil der Rechenschaft: nie gelöscht; abgelegt steht er fest (nur der Zeitpunkt des Drucks darf nachkommen).
CREATE TRIGGER finance_audit_reports_no_delete BEFORE DELETE ON finance_audit_reports
BEGIN
  SELECT RAISE(ABORT, 'an audit report is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_reports_filed_immutable BEFORE UPDATE ON finance_audit_reports
WHEN OLD.state = 'filed' AND (NEW.state IS NOT OLD.state OR NEW.exam_dates IS NOT OLD.exam_dates OR NEW.exam_place IS NOT OLD.exam_place OR NEW.exam_not_tested IS NOT OLD.exam_not_tested
  OR NEW.exam_cash_count_id IS NOT OLD.exam_cash_count_id OR NEW.signature_mode IS NOT OLD.signature_mode OR NEW.non_signer_auditor_id IS NOT OLD.non_signer_auditor_id
  OR NEW.non_signer_reason IS NOT OLD.non_signer_reason OR NEW.baseline_id IS NOT OLD.baseline_id OR NEW.kind IS NOT OLD.kind OR NEW.origin IS NOT OLD.origin)
BEGIN
  SELECT RAISE(ABORT, 'a filed audit report is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_report_results_no_delete BEFORE DELETE ON finance_audit_report_results
BEGIN
  SELECT RAISE(ABORT, 'an audit report is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_report_deviations_no_delete BEFORE DELETE ON finance_audit_report_deviations
BEGIN
  SELECT RAISE(ABORT, 'an audit report is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_report_scans_no_delete BEFORE DELETE ON finance_audit_report_scans
BEGIN
  SELECT RAISE(ABORT, 'an audit report scan is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_report_scans_immutable BEFORE UPDATE ON finance_audit_report_scans
BEGIN
  SELECT RAISE(ABORT, 'an audit report scan is immutable');
END;

--> statement-breakpoint
-- Quelle: 0023_finance_cash_count_witnesses.sql
CREATE TABLE `finance_cash_count_witnesses` (
	`count_id` text NOT NULL,
	`auditor_id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`count_id`, `auditor_id`),
	FOREIGN KEY (`count_id`) REFERENCES `finance_cash_counts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auditor_id`) REFERENCES `finance_audit_auditors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_cash_count_witnesses_auditor_idx` ON `finance_cash_count_witnesses` (`auditor_id`);
--> statement-breakpoint
-- Quelle: 0024_finance_cash_count_witnesses_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft D1 (0.4.0): Die Zeugen einer Kassenzählung gehören zu ihr — unveränderlich, nie gelöscht.
CREATE TRIGGER finance_cash_count_witnesses_no_delete BEFORE DELETE ON finance_cash_count_witnesses
BEGIN
  SELECT RAISE(ABORT, 'a cash count witness is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_cash_count_witnesses_immutable BEFORE UPDATE ON finance_cash_count_witnesses
BEGIN
  SELECT RAISE(ABORT, 'a cash count witness is immutable');
END;

--> statement-breakpoint
-- Quelle: 0025_finance_audit_report_subject_snapshot.sql
ALTER TABLE `finance_audit_reports` ADD `subject_snapshot` text;
--> statement-breakpoint
-- Quelle: 0026_finance_audit_report_subject_snapshot_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft D1d (0.4.0): Der Gegenstand eines abgelegten Prüfberichts (Schnappschuss ab der Freigabe) steht fest wie der Rest.
DROP TRIGGER finance_audit_reports_filed_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_audit_reports_filed_immutable BEFORE UPDATE ON finance_audit_reports
WHEN OLD.state = 'filed' AND (NEW.state IS NOT OLD.state OR NEW.exam_dates IS NOT OLD.exam_dates OR NEW.exam_place IS NOT OLD.exam_place OR NEW.exam_not_tested IS NOT OLD.exam_not_tested
  OR NEW.exam_cash_count_id IS NOT OLD.exam_cash_count_id OR NEW.signature_mode IS NOT OLD.signature_mode OR NEW.non_signer_auditor_id IS NOT OLD.non_signer_auditor_id
  OR NEW.non_signer_reason IS NOT OLD.non_signer_reason OR NEW.baseline_id IS NOT OLD.baseline_id OR NEW.kind IS NOT OLD.kind OR NEW.origin IS NOT OLD.origin
  OR NEW.subject_snapshot IS NOT OLD.subject_snapshot)
BEGIN
  SELECT RAISE(ABORT, 'a filed audit report is immutable');
END;

--> statement-breakpoint
-- Quelle: 0027_finance_reports_successor_locks.sql
-- Custom SQL migration file, put your code below! --
-- Rechenschaft D1d (0.4.0): Eine beim Wiederöffnen stornierte Fassung bekommt später ihren Nachfolger — einmal, von leer.
DROP TRIGGER finance_reports_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_reports_immutable BEFORE UPDATE ON finance_reports
WHEN NEW.id IS NOT OLD.id OR NEW.report_key IS NOT OLD.report_key OR NEW.params IS NOT OLD.params OR NEW.fiscal_year_id IS NOT OLD.fiscal_year_id
  OR NEW.data_hash IS NOT OLD.data_hash OR NEW.document_id IS NOT OLD.document_id OR NEW.document_number IS NOT OLD.document_number
  OR NEW.release_basis IS NOT OLD.release_basis OR NEW.finalized_at IS NOT OLD.finalized_at OR NEW.finalized_by_user_id IS NOT OLD.finalized_by_user_id
  OR (OLD.voided_at IS NOT NULL AND (NEW.voided_at IS NOT OLD.voided_at OR NEW.void_reason IS NOT OLD.void_reason
    OR (NEW.replaced_by_report_id IS NOT OLD.replaced_by_report_id AND (OLD.replaced_by_report_id IS NOT NULL OR NEW.replaced_by_report_id IS NULL))))
BEGIN
  SELECT RAISE(ABORT, 'a finalized report is immutable');
END;

--> statement-breakpoint
-- Quelle: 0028_left_mimic.sql
ALTER TABLE `finance_audit_section_reviews` ADD `rows_hash` text;
--> statement-breakpoint
-- Quelle: 0029_finance_account_statements.sql
CREATE TABLE `finance_account_statement_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`document_id` text NOT NULL,
	`period_from` text,
	`period_to` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_account_statement_documents_account_idx` ON `finance_account_statement_documents` (`account_id`,`period_to`);--> statement-breakpoint
CREATE TABLE `finance_account_year_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_account_year_confirmations_year_idx` ON `finance_account_year_confirmations` (`fiscal_year_id`,`account_id`);
--> statement-breakpoint
-- Quelle: 0030_finance_account_statements_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft C (0.4.0): Kontoauszüge je Konto und Bestätigungen je Jahr und Konto sind Tatsachen — nur anhängen.
CREATE TRIGGER finance_account_statement_documents_no_delete BEFORE DELETE ON finance_account_statement_documents
BEGIN
  SELECT RAISE(ABORT, 'an account statement document is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_account_statement_documents_immutable BEFORE UPDATE ON finance_account_statement_documents
BEGIN
  SELECT RAISE(ABORT, 'an account statement document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_account_year_confirmations_no_delete BEFORE DELETE ON finance_account_year_confirmations
BEGIN
  SELECT RAISE(ABORT, 'an account year confirmation is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_account_year_confirmations_immutable BEFORE UPDATE ON finance_account_year_confirmations
BEGIN
  SELECT RAISE(ABORT, 'an account year confirmation is immutable');
END;

--> statement-breakpoint
-- Quelle: 0031_finance_closing_confirmations.sql
CREATE TABLE `finance_closing_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`step` text NOT NULL,
	`note` text,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_closing_confirmations_year_idx` ON `finance_closing_confirmations` (`fiscal_year_id`,`step`);
--> statement-breakpoint
-- Quelle: 0032_finance_closing_confirmations_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft C (0.4.0): Bestätigungen im Jahresabschluss sind Tatsachen — nur anhängen.
CREATE TRIGGER finance_closing_confirmations_no_delete BEFORE DELETE ON finance_closing_confirmations
BEGIN
  SELECT RAISE(ABORT, 'a closing confirmation is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_closing_confirmations_immutable BEFORE UPDATE ON finance_closing_confirmations
BEGIN
  SELECT RAISE(ABORT, 'a closing confirmation is immutable');
END;

--> statement-breakpoint
-- Quelle: 0033_finance_assembly_results.sql
CREATE TABLE `finance_assembly_discharges` (
	`fiscal_year_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`outcome` text,
	`decided_on` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`fiscal_year_id`, `contact_id`),
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_assembly_results` (
	`fiscal_year_id` text PRIMARY KEY NOT NULL,
	`assembly_on` text NOT NULL,
	`minutes_document_id` text,
	`accounts_approved` text,
	`discharge_mode` text NOT NULL,
	`collective_outcome` text,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
-- Quelle: 0034_finance_audit_carry_overs.sql
CREATE TABLE `finance_audit_carry_over_entries` (
	`carry_over_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`entry_number` text NOT NULL,
	`change` text NOT NULL,
	PRIMARY KEY(`carry_over_id`, `entry_id`),
	FOREIGN KEY (`carry_over_id`) REFERENCES `finance_audit_carry_overs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finance_audit_carry_overs` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`baseline_id` text NOT NULL,
	`target_fiscal_year_id` text NOT NULL,
	`note` text NOT NULL,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`baseline_id`) REFERENCES `finance_audit_baselines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_audit_carry_overs_year_idx` ON `finance_audit_carry_overs` (`fiscal_year_id`);--> statement-breakpoint
CREATE INDEX `finance_audit_carry_overs_target_idx` ON `finance_audit_carry_overs` (`target_fiscal_year_id`);
--> statement-breakpoint
-- Quelle: 0035_finance_audit_carry_overs_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft C (0.4.0): Die Übernahme einer Nachprüfung ins Folgejahr ist eine Tatsache — nur anhängen.
CREATE TRIGGER finance_audit_carry_overs_no_delete BEFORE DELETE ON finance_audit_carry_overs
BEGIN
  SELECT RAISE(ABORT, 'an audit carry-over is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_carry_overs_immutable BEFORE UPDATE ON finance_audit_carry_overs
BEGIN
  SELECT RAISE(ABORT, 'an audit carry-over is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_carry_over_entries_no_delete BEFORE DELETE ON finance_audit_carry_over_entries
BEGIN
  SELECT RAISE(ABORT, 'an audit carry-over entry is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_audit_carry_over_entries_immutable BEFORE UPDATE ON finance_audit_carry_over_entries
BEGIN
  SELECT RAISE(ABORT, 'an audit carry-over entry is immutable');
END;

--> statement-breakpoint
-- Quelle: 0036_finance_cash_count_contact_witnesses.sql
CREATE TABLE `finance_cash_count_contact_witnesses` (
	`count_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`count_id`, `contact_id`),
	FOREIGN KEY (`count_id`) REFERENCES `finance_cash_counts`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
-- Quelle: 0037_finance_cash_count_contact_witnesses_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft C (0.4.0): Die Zeugen einer Kassenzählung aus den Kontakten gehören zu ihr — unveränderlich, nie gelöscht.
CREATE TRIGGER finance_cash_count_contact_witnesses_no_delete BEFORE DELETE ON finance_cash_count_contact_witnesses
BEGIN
  SELECT RAISE(ABORT, 'a cash count witness is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_cash_count_contact_witnesses_immutable BEFORE UPDATE ON finance_cash_count_contact_witnesses
BEGIN
  SELECT RAISE(ABORT, 'a cash count witness is immutable');
END;

--> statement-breakpoint
-- Quelle: 0038_finance_handovers.sql
CREATE TABLE `finance_handover_items` (
	`id` text PRIMARY KEY NOT NULL,
	`handover_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text,
	`note` text,
	`checked` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`handover_id`) REFERENCES `finance_handovers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_handover_items_handover_idx` ON `finance_handover_items` (`handover_id`);--> statement-breakpoint
CREATE TABLE `finance_handovers` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_id` text NOT NULL,
	`from_contact_id` text NOT NULL,
	`to_contact_id` text NOT NULL,
	`handover_on` text NOT NULL,
	`state` text NOT NULL,
	`interim_params` text,
	`interim_hash` text,
	`interim_at` text,
	`cash_count_id` text,
	`protocol_document_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_handovers_year_idx` ON `finance_handovers` (`fiscal_year_id`);
--> statement-breakpoint
-- Quelle: 0039_finance_handovers_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft C (0.4.0): Eine Amtsübergabe und ihre Punkte werden nie gelöscht; abgebrochen ist ein Zustand.
CREATE TRIGGER finance_handovers_no_delete BEFORE DELETE ON finance_handovers
BEGIN
  SELECT RAISE(ABORT, 'a handover is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_handover_items_no_delete BEFORE DELETE ON finance_handover_items
BEGIN
  SELECT RAISE(ABORT, 'a handover item is a permanent record');
END;

--> statement-breakpoint
-- Quelle: 0040_finance_category_threshold_exclusion.sql
ALTER TABLE `finance_categories` ADD `threshold_exclusion` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
-- Quelle: 0041_finance_vat_returns.sql
CREATE TABLE `finance_vat_returns` (
	`fiscal_year_id` text PRIMARY KEY NOT NULL,
	`filed_on` text NOT NULL,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
-- Quelle: 0042_finance_closing_records_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft C (0.4.0, Schlussdurchsicht): Ergebnis der MV, Entlastungen und die Abgabe der USt-Erklärung werden nie gelöscht.
CREATE TRIGGER finance_assembly_results_no_delete BEFORE DELETE ON finance_assembly_results
BEGIN
  SELECT RAISE(ABORT, 'an assembly result is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_assembly_discharges_no_delete BEFORE DELETE ON finance_assembly_discharges
BEGIN
  SELECT RAISE(ABORT, 'an assembly discharge is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_vat_returns_no_delete BEFORE DELETE ON finance_vat_returns
BEGIN
  SELECT RAISE(ABORT, 'a VAT return filing is a permanent record');
END;

--> statement-breakpoint
-- Quelle: 0043_sour_salo.sql
CREATE TABLE `finance_data_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_ids` text NOT NULL,
	`designations` text NOT NULL,
	`provisional` text DEFAULT '' NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` text,
	`channel` text NOT NULL,
	`file_deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `finance_data_exports_created_idx` ON `finance_data_exports` (`created_at`);
--> statement-breakpoint
-- Quelle: 0044_finance_tax_periods.sql
CREATE TABLE `finance_tax_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`first_fiscal_year_id` text NOT NULL,
	`last_fiscal_year_id` text NOT NULL,
	`requested_on` text,
	`with_tax_advisor` integer DEFAULT false NOT NULL,
	`due_on` text NOT NULL,
	`filed_on` text,
	`filed_report_id` text,
	`request_document_id` text,
	`filed_document_id` text,
	`transmission_document_id` text,
	`activity_report_document_id` text,
	`notice_id` text,
	`answers_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`first_fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_fiscal_year_id`) REFERENCES `finance_fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filed_report_id`) REFERENCES `finance_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`notice_id`) REFERENCES `finance_notices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_tax_periods_first_idx` ON `finance_tax_periods` (`first_fiscal_year_id`);--> statement-breakpoint
CREATE INDEX `finance_tax_periods_last_idx` ON `finance_tax_periods` (`last_fiscal_year_id`);
--> statement-breakpoint
-- Quelle: 0045_finance_tax_periods_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft D2 (0.4.0): Ein Erklärungszeitraum wird nie gelöscht; Abgabe und Bescheid hängen an ihm.
CREATE TRIGGER finance_tax_periods_no_delete BEFORE DELETE ON finance_tax_periods
BEGIN
  SELECT RAISE(ABORT, 'a tax period is a permanent record');
END;

--> statement-breakpoint
-- Quelle: 0046_finance_gem_attributes.sql
CREATE TABLE `finance_contact_tax_details` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`tax_office` text,
	`tax_number` text,
	`beneficiary_purpose` text,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_contact_tax_details_contact_idx` ON `finance_contact_tax_details` (`contact_id`);--> statement-breakpoint
ALTER TABLE `finance_allocation_lines` ADD `adds_to_assets_opt_out` text;--> statement-breakpoint
ALTER TABLE `finance_allocation_lines` ADD `asset_endowment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `finance_partner_payments` ADD `asset_endowment` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Quelle: 0047_finance_gem_attributes_locks.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft D2 (0.4.0): Vermögensausstattung und der Grund gegen die Zuführung zum Vermögen gehören zur festgeschriebenen Zeile.
DROP TRIGGER finance_allocation_lines_final_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_lines_final_no_update BEFORE UPDATE OF id, entry_id, position, category_id, amount_cents, tax_code, rate_kind, origin_line_id, adds_to_assets, direct_debit_item_id, adds_to_assets_opt_out, asset_endowment ON finance_allocation_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
-- Rechenschaft D2 (0.4.0): Die Vermögensausstattung einer Zahlung an Partner steht ab dem Einreichen fest wie die übrigen Felder.
DROP TRIGGER finance_partner_payments_submitted_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_partner_payments_submitted_immutable BEFORE UPDATE ON finance_partner_payments
WHEN OLD.state <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.partner_id IS NOT OLD.partner_id OR NEW.basis IS NOT OLD.basis OR NEW.basis_overridden IS NOT OLD.basis_overridden
  OR NEW.basis_override_reason IS NOT OLD.basis_override_reason OR NEW.purpose_text IS NOT OLD.purpose_text OR NEW.agreement_document_id IS NOT OLD.agreement_document_id
  OR NEW.retroactive IS NOT OLD.retroactive OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.copied_from_payment_id IS NOT OLD.copied_from_payment_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.proof_months IS NOT OLD.proof_months
  OR NEW.asset_endowment IS NOT OLD.asset_endowment
  OR (NEW.purpose_negative_reason IS NOT OLD.purpose_negative_reason AND (OLD.purpose_negative_reason IS NOT NULL OR OLD.state <> 'submitted'))
  OR NEW.state NOT IN ('submitted', 'approved', 'rejected')
  OR (OLD.state <> 'submitted' AND (
    NEW.state IS NOT OLD.state OR NEW.number IS NOT OLD.number OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
    OR NEW.approved_channel IS NOT OLD.approved_channel OR NEW.open_item_id IS NOT OLD.open_item_id OR NEW.proof_due_on IS NOT OLD.proof_due_on
    OR NEW.rejected_at IS NOT OLD.rejected_at OR NEW.rejected_by_user_id IS NOT OLD.rejected_by_user_id OR NEW.reject_note IS NOT OLD.reject_note
    OR (NEW.notice_reason IS NOT OLD.notice_reason AND OLD.notice_reason IS NOT NULL)
    OR (NEW.overdue_reason IS NOT OLD.overdue_reason AND OLD.overdue_reason IS NOT NULL)
  ))
  OR (OLD.state <> 'approved' AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
  OR (OLD.acknowledged_at IS NOT NULL AND (NEW.acknowledged_at IS NOT OLD.acknowledged_at OR NEW.acknowledged_by_user_id IS NOT OLD.acknowledged_by_user_id OR NEW.acknowledged_channel IS NOT OLD.acknowledged_channel))
)
BEGIN
  SELECT RAISE(ABORT, 'a submitted partner payment is permanent');
END;

--> statement-breakpoint
-- Quelle: 0048_finance_tax_periods_transfer.sql
-- Custom SQL migration file, put your code below! ---- Rechenschaft D2 (0.4.0): „Steuererklärung abgegeben am“ am Geschäftsjahr wird je Jahr ein einjähriger Erklärungszeitraum — ID = ID des Geschäftsjahres (gültige ULID, eindeutig, ohne Zufall in SQL), Frist 31.07. des Folgejahres, ohne festgeschriebene Fassung.
INSERT INTO finance_tax_periods (id, first_fiscal_year_id, last_fiscal_year_id, with_tax_advisor, due_on, filed_on, answers_json, created_at, created_by_user_id, updated_at)
SELECT id, id, id, 0, (CAST(substr(ends_on, 1, 4) AS INTEGER) + 1) || '-07-31', tax_return_filed_on, '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM finance_fiscal_years WHERE tax_return_filed_on IS NOT NULL;

--> statement-breakpoint
-- Quelle: 0049_finance_fiscal_years_drop_tax_return.sql
ALTER TABLE `finance_fiscal_years` DROP COLUMN `tax_return_filed_on`;
--> statement-breakpoint
-- Quelle: 0050_finance_tax_periods_statute.sql
ALTER TABLE `finance_tax_periods` ADD `statute_document_id` text;
--> statement-breakpoint
-- Quelle: 0051_finance_vat_entrepreneur_transfer.sql
-- Custom SQL migration file, put your code below! ---- E6a (0.4.0): Der Schalter „Unternehmer oder USt-IdNr.“ wird zur datierten Einstellung `vatEntrepreneur`. Ein gesetzter Schalter gilt als „Unternehmer ab 2000“ (Joe-Frage 1, Plan E6a); die Einstellungszeile entfällt.
INSERT INTO finance_dated_values (key, valid_from, value, updated_at, updated_by_user_id)
SELECT 'vatEntrepreneur', '2000-01-01', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system'
FROM settings WHERE key = 'finance.isEntrepreneurOrHasVatId' AND value = 'true';
--> statement-breakpoint
DELETE FROM settings WHERE key = 'finance.isEntrepreneurOrHasVatId';

--> statement-breakpoint
-- Quelle: 0052_finance_vat_marks.sql
ALTER TABLE `finance_allocation_lines` ADD `service_date` text;--> statement-breakpoint
ALTER TABLE `finance_contact_tax_details` ADD `reverse_charge` text;
--> statement-breakpoint
-- Quelle: 0053_finance_rc13b_split.sql
-- Custom SQL migration file, put your code below! ---- E6a (0.4.0): `rc13b` wird geteilt in `rc13bEu` (§ 13b Abs. 1 UStG, Kz 46/47) und `rc13bOther` (übrige, Kz 84/85). EU-Ausland = Mitgliedstaat der EU ohne DE; die Liste entspricht `EU_MEMBER_STATES` in `packages/modules/finance/src/ledger/codes.ts`. Zuordnungszeilen nach dem Sitz ihres Kontakts oder dem Land der Gegen-IBAN eines Kontoumsatzes derselben Buchung, sonst übrige; Importregeln nach ihrem Kontakt, ohne Kontakt EU; Kategorien EU (der häufigste Fall: Werbung, Software aus dem EU-Ausland).
-- Die Sperre der festgeschriebenen Zeile verliert `tax_code`: Ein eigener Trigger lässt nur den Wechsel innerhalb {none, rc13bEu, rc13bOther, icAcquisition} an Ausgaben zu (Zuordnungskorrektur, das Netto bleibt gleich), ebenso das Leistungsdatum.
DROP TRIGGER finance_allocation_lines_final_no_update;
--> statement-breakpoint
UPDATE finance_allocation_lines SET tax_code = CASE WHEN
  (SELECT upper(c.country) FROM contacts c WHERE c.id = finance_allocation_lines.contact_id) IN ('AT', 'BE', 'BG', 'CY', 'CZ', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK')
  OR EXISTS (SELECT 1 FROM finance_money_lines m JOIN finance_raw_transactions r ON r.id = m.raw_transaction_id
    WHERE m.entry_id = finance_allocation_lines.entry_id AND upper(substr(replace(r.counterparty_iban, ' ', ''), 1, 2)) IN ('AT', 'BE', 'BG', 'CY', 'CZ', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'))
  THEN 'rc13bEu' ELSE 'rc13bOther' END
WHERE tax_code = 'rc13b';
--> statement-breakpoint
UPDATE finance_import_rules SET tax_code = CASE WHEN contact_id IS NULL
  OR (SELECT upper(c.country) FROM contacts c WHERE c.id = finance_import_rules.contact_id) IN ('AT', 'BE', 'BG', 'CY', 'CZ', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK')
  THEN 'rc13bEu' ELSE 'rc13bOther' END
WHERE tax_code = 'rc13b';
--> statement-breakpoint
UPDATE finance_categories SET default_tax_code = 'rc13bEu' WHERE default_tax_code = 'rc13b';
--> statement-breakpoint
CREATE TRIGGER finance_allocation_lines_final_no_update BEFORE UPDATE OF id, entry_id, position, category_id, amount_cents, rate_kind, origin_line_id, adds_to_assets, direct_debit_item_id, adds_to_assets_opt_out, asset_endowment ON finance_allocation_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_lines_final_vat_marks BEFORE UPDATE OF tax_code, service_date ON finance_allocation_lines
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
  AND (OLD.amount_cents >= 0 OR OLD.tax_code NOT IN ('none', 'rc13bEu', 'rc13bOther', 'icAcquisition') OR NEW.tax_code NOT IN ('none', 'rc13bEu', 'rc13bOther', 'icAcquisition'))
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;

--> statement-breakpoint
-- Quelle: 0054_finance_vat_filings.sql
CREATE TABLE `finance_vat_filings` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`filed_on` text NOT NULL,
	`amendment` integer DEFAULT false NOT NULL,
	`lines_digest` text,
	`at` text NOT NULL,
	`by_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_vat_filings_period_idx` ON `finance_vat_filings` (`period`);
--> statement-breakpoint
-- Quelle: 0055_finance_vat_filings_transfer.sql
-- Custom SQL migration file, put your code below! ---- E6a (0.4.0): „USt-Erklärung abgegeben am“ je Geschäftsjahr wird eine Abgabe je Zeitraum. Je Zeile von `finance_vat_returns` eine Abgabe der Jahreserklärung für das Kalenderjahr des Endes des Geschäftsjahres (Plan E6a Task 5) — ID = ID des Geschäftsjahres (gültige ULID, ohne Zufall in SQL), ohne Fingerabdruck: Eine übertragene Abgabe meldet nie eine Berichtigung.
INSERT INTO finance_vat_filings (id, period, filed_on, amendment, lines_digest, at, by_user_id)
SELECT r.fiscal_year_id, substr(y.ends_on, 1, 4), r.filed_on, 0, NULL, r.at, r.by_user_id
FROM finance_vat_returns r JOIN finance_fiscal_years y ON y.id = r.fiscal_year_id;
--> statement-breakpoint
CREATE TRIGGER finance_vat_filings_no_delete BEFORE DELETE ON finance_vat_filings
BEGIN
  SELECT RAISE(ABORT, 'a VAT filing is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_vat_filings_no_update BEFORE UPDATE ON finance_vat_filings
BEGIN
  SELECT RAISE(ABORT, 'a VAT filing is a permanent record');
END;

--> statement-breakpoint
-- Quelle: 0056_finance_vat_returns_drop.sql
DROP TABLE `finance_vat_returns`;
--> statement-breakpoint
-- Quelle: 0057_natural_garia.sql
ALTER TABLE `finance_vat_filings` ADD `lines_snapshot` text;
--> statement-breakpoint
-- Quelle: 0058_aberrant_sentinels.sql
ALTER TABLE `finance_contact_tax_details` ADD `reverse_charge_decline_reason` text;--> statement-breakpoint
ALTER TABLE `finance_contact_tax_details` ADD `reverse_charge_decline_text` text;--> statement-breakpoint
ALTER TABLE `finance_contact_tax_details` ADD `reverse_charge_decline_on` text;--> statement-breakpoint
ALTER TABLE `finance_contact_tax_details` ADD `reverse_charge_decline_by_user_id` text;
--> statement-breakpoint
-- Quelle: 0059_chubby_barracuda.sql
ALTER TABLE `finance_vat_filings` ADD `figures` text;--> statement-breakpoint
ALTER TABLE `finance_vat_filings` ADD `report_id` text;--> statement-breakpoint
ALTER TABLE `finance_vat_filings` ADD `filed_return_document_id` text;--> statement-breakpoint
ALTER TABLE `finance_vat_filings` ADD `transmission_protocol_document_id` text;
--> statement-breakpoint
-- Quelle: 0060_finance_vat_filings_update.sql
-- Custom SQL migration file, put your code below! ---- E6b (Plan Task 6): An der Abgabe ändern sich nur der Tag der Abgabe, die verknüpfte festgeschriebene Fassung und die
-- Ablage (abgegebene Fassung, ELSTER-Protokoll); Zeitraum, Berichtigung, Fingerabdruck, Abbilder, Zeit und Person bleiben.
DROP TRIGGER finance_vat_filings_no_update;
--> statement-breakpoint
CREATE TRIGGER finance_vat_filings_no_update BEFORE UPDATE OF id, period, amendment, lines_digest, lines_snapshot, figures, at, by_user_id ON finance_vat_filings
BEGIN
  SELECT RAISE(ABORT, 'a VAT filing is a permanent record');
END;
