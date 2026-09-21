CREATE TABLE `finance_entry_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`document_id` text,
	`document_number` text NOT NULL,
	`document_checksum` text,
	`document_deleted_at` text,
	`added_at` text NOT NULL,
	`added_by_user_id` text NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` text,
	`revoke_note` text,
	`replaced_by_link_id` text,
	FOREIGN KEY (`entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_entry_documents_pair_idx` ON `finance_entry_documents` (`entry_id`,`document_id`);--> statement-breakpoint
CREATE INDEX `finance_entry_documents_document_idx` ON `finance_entry_documents` (`document_id`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Eine Belegverknüpfung ist auf
-- Datenbankebene dauerhaft (Finanz-Spec 5.2): Was sie ansteuert, ändert sich
-- nie — weder im Entwurf noch nach dem Festschreiben; gelöscht wird sie nur,
-- solange die Buchung ein Entwurf ist. Die Dokument-ID darf nur verschwinden
-- (Grabstein, F2c), nie auf ein anderes Dokument zeigen. Ein Widerruf trägt
-- vier Spalten und lässt sich genau einmal setzen.
CREATE TRIGGER finance_entry_documents_no_retarget BEFORE UPDATE OF id, entry_id, document_number, document_checksum, added_at, added_by_user_id ON finance_entry_documents
BEGIN
  SELECT RAISE(ABORT, 'finance voucher link is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_entry_documents_document_only_cleared BEFORE UPDATE OF document_id ON finance_entry_documents
WHEN NEW.document_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'finance voucher link is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_entry_documents_revoke_once BEFORE UPDATE OF revoked_at, revoked_by_user_id, revoke_note, replaced_by_link_id ON finance_entry_documents
WHEN OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'finance voucher link is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER finance_entry_documents_final_no_delete BEFORE DELETE ON finance_entry_documents
WHEN (SELECT status FROM finance_entries WHERE id = OLD.entry_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finance voucher link is permanent');
END;