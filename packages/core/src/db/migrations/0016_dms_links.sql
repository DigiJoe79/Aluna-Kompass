-- Datenmigration, Muster 0006_i18n_locales.sql: die Umbau-Migrationen 0014/0015
-- brachten Form (Spalten), diese Migration bringt die Werte, bevor 0017 die
-- Übergangsspalten löscht und `type_key`/`document_date`/`updated_at` verriegelt.

-- Jede vorhandene Zeile war ein Brief (der einzige Akteneintrag vor diesem
-- Umzug). Die Dokumentart existiert als Stammdatensatz noch nicht — sie wird
-- hier für den Bestand angelegt, mit dem Präfix, das die alten Nummern schon
-- tragen (BRF-JJJJ-NNN), und der Aufbewahrungsklasse für Geschäftsbriefe
-- (§ 147 Abs. 3 AO). Ein Verein kann sie danach unter Verwaltung anpassen.
INSERT INTO `document_types` (`key`, `label`, `prefix`, `default_direction`, `retention_class`, `default_folder`, `is_active`, `sort_order`)
SELECT 'letter', 'Brief', 'BRF', 'outgoing', 'statutory6Y', NULL, 1, 0
WHERE EXISTS (SELECT 1 FROM `documents` WHERE `type_key` IS NULL)
  AND NOT EXISTS (SELECT 1 FROM `document_types` WHERE `key` = 'letter');
--> statement-breakpoint

-- Bestand nachziehen: Art, Dokumentdatum (aus dem Erzeugungsdatum, da es zu
-- diesen Zeilen kein anderes gibt), letzte Änderung. `phase` bekam beim
-- Anlegen der Spalte (0015) den Vorgabewert 'draft' — falsch für Zeilen, die
-- längst festgeschrieben sind (sie tragen Nummer, Datei und `status`).
UPDATE `documents`
SET `type_key` = 'letter',
    `phase` = 'issued',
    `document_date` = substr(`created_at`, 1, 10),
    `updated_at` = `created_at`
WHERE `type_key` IS NULL;
--> statement-breakpoint

-- Der bisherige `entityType`/`entityId`-Bezug wandert als `about`-Link
-- (Entscheidung 15/§ 4). SQLite kann hier keine ULID erzeugen; das ist der
-- einzige Ort, an dem das vorkommt, und die Zeilen stammen aus einer
-- Installation mit höchstens einer Handvoll Dokumenten.
INSERT INTO `document_links` (`id`, `document_id`, `entity_type`, `entity_id`, `role`, `created_at`)
SELECT lower(hex(randomblob(16))), `id`, `entity_type`, `entity_id`, 'about', `created_at`
FROM `documents`
WHERE `entity_type` IS NOT NULL AND `entity_id` IS NOT NULL;
