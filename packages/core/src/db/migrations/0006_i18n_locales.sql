INSERT INTO `settings` (`key`, `value`, `updated_at`)
SELECT 'i18n.locales', '["de","en"]', '1970-01-01T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM `users`)
  AND NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'i18n.locales');
