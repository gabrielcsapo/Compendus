CREATE TABLE `book_images` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`passage_id` text,
	`spine_index` integer,
	`ordinal` integer NOT NULL,
	`char_start` integer,
	`stored_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`alt` text,
	`caption` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_book_images_book` ON `book_images` (`book_id`);--> statement-breakpoint
CREATE INDEX `idx_book_images_passage` ON `book_images` (`passage_id`);