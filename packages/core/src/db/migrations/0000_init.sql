CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_idx` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`user_id` text,
	`channel` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`before` text,
	`after` text,
	`summary` text NOT NULL,
	`api_token_id` text,
	`ip_address` text,
	`request_id` text NOT NULL,
	`environment` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_occurred_idx` ON `audit_log` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_user_idx` ON `audit_log` (`user_id`);--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`due_at` text NOT NULL,
	`title` text NOT NULL,
	`assignee_user_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`done_at` text,
	`done_by_user_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `follow_ups_entity_idx` ON `follow_ups` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `follow_ups_due_idx` ON `follow_ups` (`done_at`,`due_at`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`uploaded_by_user_id` text,
	`created_at` text NOT NULL,
	`folder` text,
	`checksum` text,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_filename_unique` ON `media_assets` (`filename`);--> statement-breakpoint
CREATE TABLE `media_folders` (
	`path` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission_key` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission_key`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_protected` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `animal_photos` (
	`animal_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`animal_id`, `asset_id`),
	FOREIGN KEY (`animal_id`) REFERENCES `animals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `animal_stories` (
	`animal_id` text PRIMARY KEY NOT NULL,
	`before_asset_id` text,
	`after_asset_id` text,
	`quote` text NOT NULL,
	`family` text DEFAULT '' NOT NULL,
	`adopted_year` integer NOT NULL,
	`before_caption` text DEFAULT '{}' NOT NULL,
	`after_caption` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`animal_id`) REFERENCES `animals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`before_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`after_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `animals` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`species` text DEFAULT 'dog' NOT NULL,
	`sex` text NOT NULL,
	`birth_text` text NOT NULL,
	`size_cm` integer DEFAULT 0 NOT NULL,
	`size_text` text NOT NULL,
	`location` text DEFAULT 'shelter' NOT NULL,
	`status` text DEFAULT 'lookingForHome' NOT NULL,
	`is_emergency` integer DEFAULT false NOT NULL,
	`is_sponsorable` integer DEFAULT false NOT NULL,
	`traits` text DEFAULT '{}' NOT NULL,
	`external_profile_url` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `animals_slug_unique` ON `animals` (`slug`);--> statement-breakpoint
CREATE INDEX `animals_status_idx` ON `animals` (`status`);--> statement-breakpoint
CREATE TABLE `contact_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`label` text,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contact_channels_contact_idx` ON `contact_channels` (`contact_id`);--> statement-breakpoint
CREATE TABLE `contact_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`role` text NOT NULL,
	`since` text NOT NULL,
	`until` text,
	`note` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contact_roles_contact_idx` ON `contact_roles` (`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_roles_role_idx` ON `contact_roles` (`role`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`salutation` text,
	`first_name` text,
	`last_name` text,
	`name` text,
	`legal_form` text,
	`belongs_to_id` text,
	`address_extra` text,
	`street` text,
	`postal_code` text,
	`city` text,
	`country` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`belongs_to_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_status_idx` ON `contacts` (`status`);--> statement-breakpoint
CREATE INDEX `contacts_belongs_to_idx` ON `contacts` (`belongs_to_id`);--> statement-breakpoint
CREATE TABLE `document_counters` (
	`prefix` text NOT NULL,
	`year` integer NOT NULL,
	`last` integer NOT NULL,
	PRIMARY KEY(`prefix`, `year`)
);
--> statement-breakpoint
CREATE TABLE `document_folders` (
	`path` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_links_unique_idx` ON `document_links` (`document_id`,`entity_type`,`entity_id`,`role`);--> statement-breakpoint
CREATE INDEX `document_links_entity_idx` ON `document_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `document_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`body` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_notes_document_idx` ON `document_notes` (`document_id`);--> statement-breakpoint
CREATE TABLE `document_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`related_document_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_relations_unique_idx` ON `document_relations` (`document_id`,`related_document_id`,`kind`);--> statement-breakpoint
CREATE INDEX `document_relations_related_idx` ON `document_relations` (`related_document_id`);--> statement-breakpoint
CREATE TABLE `document_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`match_field` text NOT NULL,
	`match_contains` text NOT NULL,
	`then_type_key` text,
	`then_folder` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`then_type_key`) REFERENCES `document_types`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_rules_sort_idx` ON `document_rules` (`sort_order`);--> statement-breakpoint
CREATE TABLE `document_snippets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subject` text,
	`body` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_snippets_name_idx` ON `document_snippets` (`name`);--> statement-breakpoint
CREATE TABLE `document_types` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`prefix` text NOT NULL,
	`default_direction` text NOT NULL,
	`retention_class` text NOT NULL,
	`default_folder` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`phase` text DEFAULT 'draft' NOT NULL,
	`direction` text DEFAULT 'outgoing' NOT NULL,
	`source_kind` text DEFAULT 'generated' NOT NULL,
	`type_key` text NOT NULL,
	`number` text,
	`subject` text DEFAULT '' NOT NULL,
	`document_date` text NOT NULL,
	`folder` text,
	`draft_body` text,
	`template_key` text,
	`input_snapshot` text,
	`file_name` text,
	`file_checksum` text,
	`file_bytes` integer,
	`text_status` text,
	`text_attempts` integer DEFAULT 0 NOT NULL,
	`text_error` text,
	`text_extracted_at` text,
	`sent_at` text,
	`sent_via` text,
	`sent_note` text,
	`status` text DEFAULT 'issued' NOT NULL,
	`voided_at` text,
	`voided_by_user_id` text,
	`void_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`type_key`) REFERENCES `document_types`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_number_idx` ON `documents` (`number`);--> statement-breakpoint
CREATE INDEX `documents_folder_idx` ON `documents` (`folder`);--> statement-breakpoint
CREATE INDEX `documents_phase_idx` ON `documents` (`phase`);--> statement-breakpoint
CREATE INDEX `documents_text_status_idx` ON `documents` (`text_status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`image_asset_id` text,
	`external_links` text DEFAULT '[]' NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_sort_idx` ON `projects` (`sort_order`);--> statement-breakpoint
CREATE TABLE `site_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`collection` text NOT NULL,
	`slug` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_entries_collection` ON `site_entries` (`collection`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_entries_slug` ON `site_entries` (`collection`,`slug`);--> statement-breakpoint
CREATE TABLE `site_publishes` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`pages_changed` integer DEFAULT 0 NOT NULL,
	`pages_added` integer DEFAULT 0 NOT NULL,
	`pages_removed` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`triggered_by_user_id` text,
	`log` text DEFAULT '' NOT NULL,
	`file_manifest` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `site_template_state` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`schema_json` text NOT NULL,
	`checksum` text NOT NULL,
	`read_at` text NOT NULL,
	`read_by_user_id` text
);
--> statement-breakpoint
CREATE TABLE `site_values` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
-- Von Hand angefügt, weil drizzle-kit nur kennt, was im Schema steht
-- (Wächter: tests/migrations.test.ts).
--
-- Das Änderungsprotokoll ist auf Datenbankebene unveränderlich (Prinzip 3):
-- Jeder Schreibweg der Anwendung läuft in diese Trigger.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable');
END;
--> statement-breakpoint
-- Volltextindex der Akte: eine Zeile je Seite.
--
-- Trigramm-Tokenizer, weil deutsche Komposita sonst unauffindbar bleiben —
-- "rechnung" findet "Tierarztrechnung" nur so. `remove_diacritics 1` faltet
-- Umlaute, damit "katzin" die "Kaetzin" trifft. Der Preis: Suchbegriffe unter
-- drei Zeichen finden nichts, und der Index wiegt rund das Dreifache des Texts.
--
-- Der Text liegt IN der Tabelle, nicht bloss sein Index: `snippet()` braucht
-- ihn, um die Fundstelle zu bauen.
--
-- Abgeleitet im Sinne von Prinzip 5: jederzeit aus den PDFs neu baubar, nie
-- Quelle von irgendetwas.
CREATE VIRTUAL TABLE `document_text` USING fts5(
  document_id UNINDEXED,
  page UNINDEXED,
  text,
  tokenize = 'trigram remove_diacritics 1'
);
