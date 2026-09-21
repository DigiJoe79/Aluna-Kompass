CREATE TABLE `finance_cash_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`counted_on` text NOT NULL,
	`counted_cents` integer NOT NULL,
	`book_cents` integer NOT NULL,
	`difference_cents` integer NOT NULL,
	`counter_one_contact_id` text NOT NULL,
	`counter_two_contact_id` text NOT NULL,
	`counter_one_name` text NOT NULL,
	`counter_two_name` text NOT NULL,
	`note` text,
	`denominations` text,
	`document_id` text,
	`document_number` text NOT NULL,
	`entry_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finance_cash_counts_account_idx` ON `finance_cash_counts` (`account_id`,`counted_on`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Eine Kassenzählung ist eine
-- gespeicherte Tatsache (Finanz-Spec 5.5) — auf Datenbankebene dauerhaft.
-- Einzige Ausnahme: Die Dokument-ID darf nur verschwinden (Grabstein beim
-- Löschen des Dokuments, Muster `finance_entry_documents`), nie auf ein
-- anderes Dokument zeigen.
CREATE TRIGGER finance_cash_counts_no_update BEFORE UPDATE OF id, account_id, counted_on, counted_cents, book_cents, difference_cents, counter_one_contact_id, counter_two_contact_id, counter_one_name, counter_two_name, note, denominations, document_number, entry_id, created_by_user_id, created_at ON finance_cash_counts
BEGIN
  SELECT RAISE(ABORT, 'a cash count is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_cash_counts_document_only_cleared BEFORE UPDATE OF document_id ON finance_cash_counts
WHEN NEW.document_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a cash count is a permanent record');
END;
--> statement-breakpoint
CREATE TRIGGER finance_cash_counts_no_delete BEFORE DELETE ON finance_cash_counts
BEGIN
  SELECT RAISE(ABORT, 'a cash count is a permanent record');
END;