-- Projekte werden ein Modul. Die Betterplace-ID wird zu einem Verweis nach
-- aussen — Bezeichnung plus Adresse —, damit der Kern keinen Anbieter kennt.
UPDATE `projects`
SET `external_links` = json_array(json_object('label', 'Betterplace', 'url', 'https://www.betterplace.org/de/projects/' || `betterplace_project_id`))
WHERE `betterplace_project_id` <> '' AND `external_links` = '[]';
--> statement-breakpoint
-- Wo Projekte liegen, bleibt das Modul eingeschaltet: erst die Liste ergänzen …
UPDATE `settings`
SET `value` = json_insert(`value`, '$[#]', 'projects')
WHERE `key` = 'modules.enabled'
  AND EXISTS (SELECT 1 FROM `projects`)
  AND NOT EXISTS (SELECT 1 FROM json_each(`settings`.`value`) WHERE json_each.value = 'projects');
--> statement-breakpoint
-- … oder sie anlegen, wenn noch nie ein Modul geschaltet wurde.
INSERT INTO `settings` (`key`, `value`, `updated_at`, `updated_by_user_id`)
SELECT 'modules.enabled', '["projects"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
WHERE EXISTS (SELECT 1 FROM `projects`)
  AND NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'modules.enabled');
