-- Wer heute die Akte befüllen darf, darf ab jetzt auch Wiedervorlagen sehen
-- und pflegen. Sonst stünde nach dem Update jede Rolle vor einem leeren
-- Kasten, bis ein Admin die Rechte nachträgt.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_key`)
SELECT `role_id`, 'followUps.view' FROM `role_permissions` WHERE `permission_key` = 'dms.create';--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_key`)
SELECT `role_id`, 'followUps.manage' FROM `role_permissions` WHERE `permission_key` = 'dms.create';
