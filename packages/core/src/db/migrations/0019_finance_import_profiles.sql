CREATE TABLE `finance_import_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`header_signature` text NOT NULL,
	`builtin_key` text,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_channel` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `finance_accounts` ADD `import_profile_id` text;--> statement-breakpoint
ALTER TABLE `finance_import_runs` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `finance_import_runs` ADD `profile_name` text;--> statement-breakpoint
UPDATE `finance_accounts` SET `import_format` = NULL WHERE `import_format` = 'csv' AND `import_profile_id` IS NULL;
--> statement-breakpoint
CREATE TRIGGER finance_import_profiles_no_update BEFORE UPDATE ON finance_import_profiles
BEGIN
  SELECT RAISE(ABORT, 'a csv import format is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_profiles_no_delete_used BEFORE DELETE ON finance_import_profiles
WHEN EXISTS (SELECT 1 FROM finance_accounts WHERE import_profile_id = OLD.id) OR EXISTS (SELECT 1 FROM finance_import_runs WHERE profile_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'a csv import format in use cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER finance_accounts_profile_matches_format_insert BEFORE INSERT ON finance_accounts
WHEN (COALESCE(NEW.import_format, '') = 'csv') <> (NEW.import_profile_id IS NOT NULL)
  OR (NEW.import_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM finance_import_profiles WHERE id = NEW.import_profile_id))
BEGIN
  SELECT RAISE(ABORT, 'import format and csv import format must match');
END;
--> statement-breakpoint
CREATE TRIGGER finance_accounts_profile_matches_format_update BEFORE UPDATE OF import_format, import_profile_id ON finance_accounts
WHEN (COALESCE(NEW.import_format, '') = 'csv') <> (NEW.import_profile_id IS NOT NULL)
  OR (NEW.import_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM finance_import_profiles WHERE id = NEW.import_profile_id))
BEGIN
  SELECT RAISE(ABORT, 'import format and csv import format must match');
END;
--> statement-breakpoint
CREATE TRIGGER finance_import_runs_profile_immutable BEFORE UPDATE OF profile_id, profile_name ON finance_import_runs
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
