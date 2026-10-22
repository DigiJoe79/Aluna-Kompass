-- Fassung 0.3.1, zusammengelegt aus 0010_true_skin und 0011_finance_locked_columns.
-- Bildkennzeichnung: Art eines Mediums (keine, bearbeitet, mit KI erstellt).
ALTER TABLE `media_assets` ADD `ai_kind` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
-- Testdurchsicht 2026-10-22: Spalten gesperrter Finanztabellen, die bisher nur der Dienst schützte.
-- Der Versandvermerk einer Zuwendungsbestätigung wird einmal gesetzt und steht danach fest.
CREATE TRIGGER finance_confirmations_sent_once BEFORE UPDATE OF sent_at, sent_via ON finance_confirmations
WHEN OLD.sent_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a finance confirmation is permanent');
END;
--> statement-breakpoint
-- Die Warnungen eines Laufs entstehen mit seinem Abschluss und stehen danach fest.
CREATE TRIGGER finance_import_runs_warnings_immutable BEFORE UPDATE OF warnings ON finance_import_runs
WHEN OLD.finished_at IS NOT NULL OR OLD.failed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
--> statement-breakpoint
-- Die Herkunft eines Kandidaten steht fest. `line` bleibt bewusst frei: Die rohe Bankzeile trägt Namen und IBAN, und
-- die Anonymisierung nach Ablauf der Aufbewahrung (Personenbezug entfernen) muss sie leeren können.
CREATE TRIGGER finance_import_candidates_identity_immutable BEFORE UPDATE OF id, run_id, account_id, dedup_key ON finance_import_candidates
BEGIN
  SELECT RAISE(ABORT, 'an import candidate is permanent');
END;
--> statement-breakpoint
-- Der Treffer auf einen bekannten Umsatz darf nur geleert werden (Verwerfen eines Laufs, import/discard.ts).
CREATE TRIGGER finance_import_candidates_match_only_cleared BEFORE UPDATE OF matches_raw_transaction_id ON finance_import_candidates
WHEN NEW.matches_raw_transaction_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an import candidate is permanent');
END;
