DROP TABLE `website_articles`;--> statement-breakpoint
DROP TABLE `website_downloads`;--> statement-breakpoint
DROP TABLE `website_faqs`;--> statement-breakpoint
DROP TABLE `website_pages`;--> statement-breakpoint
DROP TABLE `website_team`;--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`key`, `value`, `updated_at`)
SELECT 'site.blockedTerms', `value`, `updated_at` FROM `settings` WHERE `key` = 'website.blockedTerms';--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_key`)
SELECT `role_id`, 'projects.view' FROM `role_permissions` WHERE `permission_key` = 'website.view';--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_key`)
SELECT `role_id`, 'projects.manage' FROM `role_permissions` WHERE `permission_key` = 'website.manage';--> statement-breakpoint
DELETE FROM `role_permissions` WHERE `permission_key` LIKE 'website.%';
