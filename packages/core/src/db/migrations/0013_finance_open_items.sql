CREATE TABLE `finance_open_item_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`money_line_id` text NOT NULL,
	`open_item_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`money_line_id`) REFERENCES `finance_money_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`open_item_id`) REFERENCES `finance_open_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_open_item_settlements_pair_idx` ON `finance_open_item_settlements` (`money_line_id`,`open_item_id`);--> statement-breakpoint
CREATE INDEX `finance_open_item_settlements_item_idx` ON `finance_open_item_settlements` (`open_item_id`);--> statement-breakpoint
CREATE TABLE `finance_open_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`item_date` text NOT NULL,
	`contact_id` text,
	`amount_cents` integer NOT NULL,
	`due_on` text,
	`document_id` text,
	`origin_type` text,
	`origin_id` text,
	`payment_reference` text,
	`line_template` text,
	`cancelled_at` text,
	`cancelled_by_user_id` text,
	`cancel_note` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_open_items_kind_idx` ON `finance_open_items` (`kind`);--> statement-breakpoint
CREATE INDEX `finance_open_items_origin_idx` ON `finance_open_items` (`origin_type`,`origin_id`);--> statement-breakpoint
CREATE INDEX `finance_open_items_contact_idx` ON `finance_open_items` (`contact_id`);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts). Settlements einer festgeschriebenen
-- Buchung sind so fest wie ihre Zeilen (Finanz-Spec 5.3).
CREATE TRIGGER finance_open_item_settlements_final_no_update BEFORE UPDATE ON finance_open_item_settlements
WHEN (SELECT e.status FROM finance_entries e JOIN finance_money_lines m ON m.entry_id = e.id WHERE m.id = OLD.money_line_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_open_item_settlements_final_no_delete BEFORE DELETE ON finance_open_item_settlements
WHEN (SELECT e.status FROM finance_entries e JOIN finance_money_lines m ON m.entry_id = e.id WHERE m.id = OLD.money_line_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER finance_open_item_settlements_final_no_insert BEFORE INSERT ON finance_open_item_settlements
WHEN (SELECT e.status FROM finance_entries e JOIN finance_money_lines m ON m.entry_id = e.id WHERE m.id = NEW.money_line_id) = 'final'
BEGIN
  SELECT RAISE(ABORT, 'finalized finance entry is immutable');
END;