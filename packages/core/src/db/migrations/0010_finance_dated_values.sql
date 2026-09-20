CREATE TABLE `finance_dated_values` (
	`key` text NOT NULL,
	`valid_from` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text,
	PRIMARY KEY(`key`, `valid_from`)
);
