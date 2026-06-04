CREATE TABLE `device_book_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`book_id` text NOT NULL,
	`device_id` text NOT NULL,
	`device_name` text DEFAULT '' NOT NULL,
	`device_type` text DEFAULT 'other' NOT NULL,
	`reading_progress` real DEFAULT 0,
	`last_position` text,
	`last_read_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dbp_profile_book_device` ON `device_book_progress` (`profile_id`,`book_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `idx_dbp_profile_book` ON `device_book_progress` (`profile_id`,`book_id`);--> statement-breakpoint
CREATE INDEX `idx_dbp_profile` ON `device_book_progress` (`profile_id`);