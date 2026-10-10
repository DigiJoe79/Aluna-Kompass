-- Fassung 0.2.10: die Entwicklungsmigrationen 0007_animal_proposals und 0008_site_content_manifest,
-- unverändert in ihrer Reihenfolge verkettet (nicht neu erzeugt), damit sie auf Bestandsdaten genauso wirken
-- wie in der alten Reihe.
-- Quelle: 0007_animal_proposals.sql
-- Vorschlags-Eingang der Tiere (Spec 2026-10-09, Fassung 0.2.10): Vorschläge einer Quelle, ihre Bilder, die Herkunft
-- eines Tiers; Ausschnitt und Herkunft je Foto. Nur neue Tabellen und neue, leere Spalten — bestehende Daten bleiben.
CREATE TABLE `animal_origins` (
	`id` text PRIMARY KEY NOT NULL,
	`animal_id` text NOT NULL,
	`source_user_id` text NOT NULL,
	`external_ref` text NOT NULL,
	`external_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`animal_id`) REFERENCES `animals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `animal_origins_source_ref_idx` ON `animal_origins` (`source_user_id`,`external_ref`);--> statement-breakpoint
CREATE INDEX `animal_origins_animal_idx` ON `animal_origins` (`animal_id`);--> statement-breakpoint
CREATE TABLE `animal_proposal_images` (
	`id` text PRIMARY KEY NOT NULL,
	`source_user_id` text NOT NULL,
	`proposal_id` text,
	`filename` text,
	`mime_type` text,
	`bytes` integer,
	`width` integer,
	`height` integer,
	`checksum` text,
	`source_ref` text,
	`position` integer,
	`is_primary` integer DEFAULT false NOT NULL,
	`crop` text,
	`media_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposal_id`) REFERENCES `animal_proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `animal_proposal_images_proposal_idx` ON `animal_proposal_images` (`proposal_id`);--> statement-breakpoint
CREATE INDEX `animal_proposal_images_staged_idx` ON `animal_proposal_images` (`source_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `animal_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`source_user_id` text NOT NULL,
	`source_key` text NOT NULL,
	`kind` text NOT NULL,
	`animal_id` text,
	`external_ref` text,
	`external_url` text,
	`trail_url` text,
	`values` text,
	`hints` text,
	`baseline` text,
	`reason` text,
	`notice_kind` text,
	`state` text DEFAULT 'open' NOT NULL,
	`decided_at` text,
	`decision_note` text,
	`decision_reason` text,
	`final` text,
	`same_as_answer` text,
	`cleared_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `animal_proposals_source_key_idx` ON `animal_proposals` (`source_user_id`,`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `animal_proposals_open_update_idx` ON `animal_proposals` (`source_user_id`,`animal_id`) WHERE "animal_proposals"."state" = 'open' and "animal_proposals"."kind" = 'update';--> statement-breakpoint
CREATE UNIQUE INDEX `animal_proposals_open_create_idx` ON `animal_proposals` (`source_user_id`,`external_ref`) WHERE "animal_proposals"."state" = 'open' and "animal_proposals"."kind" = 'create';--> statement-breakpoint
CREATE INDEX `animal_proposals_state_idx` ON `animal_proposals` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `animal_proposals_animal_idx` ON `animal_proposals` (`animal_id`);--> statement-breakpoint
ALTER TABLE `animal_photos` ADD `crop` text;--> statement-breakpoint
ALTER TABLE `animal_photos` ADD `source_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `animal_photos` ADD `source_ref` text;
--> statement-breakpoint
-- Quelle: 0008_site_content_manifest.sql
-- „Nicht publiziert“ (Plan C, Fassung 0.2.10): Jeder erfolgreiche Publish hält den öffentlichen Stand je Datensatz fest.
-- Ältere Publishes behalten NULL und gelten nicht als Vergleichsstand.
ALTER TABLE `site_publishes` ADD `content_manifest` text;