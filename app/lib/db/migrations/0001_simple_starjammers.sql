CREATE TABLE `wanted_books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`authors` text,
	`publisher` text,
	`published_date` text,
	`description` text,
	`isbn` text,
	`isbn13` text,
	`isbn10` text,
	`language` text,
	`page_count` integer,
	`series` text,
	`series_number` text,
	`cover_url` text,
	`source` text NOT NULL,
	`source_id` text,
	`status` text DEFAULT 'wishlist' NOT NULL,
	`priority` integer DEFAULT 0,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wanted_books_series` ON `wanted_books` (`series`);--> statement-breakpoint
CREATE INDEX `idx_wanted_books_status` ON `wanted_books` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wanted_books_source` ON `wanted_books` (`source`,`source_id`);