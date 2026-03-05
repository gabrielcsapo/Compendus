-- Phase 1: Create profiles table
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`avatar` text,
	`pin_hash` text,
	`is_admin` integer DEFAULT false,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profiles_name` ON `profiles` (`name`);
--> statement-breakpoint

-- Phase 2: Insert default admin profile with known ID
INSERT INTO `profiles` (`id`, `name`, `avatar`, `is_admin`, `created_at`, `updated_at`)
VALUES ('default-owner-profile', 'Owner', '📚', 1, unixepoch(), unixepoch());
--> statement-breakpoint

-- Phase 3: Create user_book_state table
CREATE TABLE `user_book_state` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`book_id` text NOT NULL,
	`reading_progress` real DEFAULT 0,
	`last_read_at` integer,
	`last_position` text,
	`is_read` integer DEFAULT false,
	`rating` integer,
	`review` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ubs_profile_book` ON `user_book_state` (`profile_id`,`book_id`);
--> statement-breakpoint
CREATE INDEX `idx_ubs_profile` ON `user_book_state` (`profile_id`);
--> statement-breakpoint
CREATE INDEX `idx_ubs_book` ON `user_book_state` (`book_id`);
--> statement-breakpoint
CREATE INDEX `idx_ubs_last_read` ON `user_book_state` (`last_read_at`);
--> statement-breakpoint

-- Phase 4: Copy reading state from books to user_book_state for default profile
-- Only copy books that have any reading state (not all-default)
INSERT INTO `user_book_state` (`id`, `profile_id`, `book_id`, `reading_progress`, `last_read_at`, `last_position`, `is_read`, `rating`, `review`, `updated_at`)
SELECT
  'ubs-' || `id`,
  'default-owner-profile',
  `id`,
  `reading_progress`,
  `last_read_at`,
  `last_position`,
  `is_read`,
  `rating`,
  `review`,
  COALESCE(`updated_at`, unixepoch())
FROM `books`
WHERE `reading_progress` > 0
   OR `last_read_at` IS NOT NULL
   OR `last_position` IS NOT NULL
   OR `is_read` = 1
   OR `rating` IS NOT NULL
   OR `review` IS NOT NULL;
--> statement-breakpoint

-- Phase 5: Add profileId to existing tables with default value for existing rows
-- Collections: drop old unique index, add profileId, create new composite unique index
DROP INDEX `idx_collections_name`;
--> statement-breakpoint
ALTER TABLE `collections` ADD `profile_id` text NOT NULL DEFAULT 'default-owner-profile';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collections_name_profile` ON `collections` (`name`,`profile_id`);
--> statement-breakpoint
CREATE INDEX `idx_collections_profile` ON `collections` (`profile_id`);
--> statement-breakpoint

-- Tags: drop old unique index, add profileId, create new composite unique index
DROP INDEX `idx_tags_name`;
--> statement-breakpoint
ALTER TABLE `tags` ADD `profile_id` text NOT NULL DEFAULT 'default-owner-profile';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tags_name_profile` ON `tags` (`name`,`profile_id`);
--> statement-breakpoint
CREATE INDEX `idx_tags_profile` ON `tags` (`profile_id`);
--> statement-breakpoint

-- BookEdits: nullable profileId (system edits have no profile)
ALTER TABLE `book_edits` ADD `profile_id` text;
--> statement-breakpoint

-- Bookmarks: add profileId, updatedAt, deletedAt
ALTER TABLE `bookmarks` ADD `profile_id` text NOT NULL DEFAULT 'default-owner-profile';
--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `updated_at` integer NOT NULL DEFAULT (unixepoch());
--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `deleted_at` integer;
--> statement-breakpoint
CREATE INDEX `idx_bookmarks_profile` ON `bookmarks` (`profile_id`);
--> statement-breakpoint

-- Highlights: add profileId, updatedAt, deletedAt
ALTER TABLE `highlights` ADD `profile_id` text NOT NULL DEFAULT 'default-owner-profile';
--> statement-breakpoint
ALTER TABLE `highlights` ADD `updated_at` integer NOT NULL DEFAULT (unixepoch());
--> statement-breakpoint
ALTER TABLE `highlights` ADD `deleted_at` integer;
--> statement-breakpoint
CREATE INDEX `idx_highlights_profile` ON `highlights` (`profile_id`);
--> statement-breakpoint

-- Reading sessions: add profileId
ALTER TABLE `reading_sessions` ADD `profile_id` text NOT NULL DEFAULT 'default-owner-profile';
--> statement-breakpoint
CREATE INDEX `idx_sessions_profile` ON `reading_sessions` (`profile_id`);
--> statement-breakpoint

-- Wanted books: add profileId
ALTER TABLE `wanted_books` ADD `profile_id` text NOT NULL DEFAULT 'default-owner-profile';
--> statement-breakpoint
CREATE INDEX `idx_wanted_books_profile` ON `wanted_books` (`profile_id`);
