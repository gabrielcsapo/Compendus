CREATE TABLE `book_analysis` (
	`book_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`pipeline_version` text,
	`model` text,
	`passage_count` integer DEFAULT 0 NOT NULL,
	`entity_count` integer DEFAULT 0 NOT NULL,
	`relationship_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`analyzed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_book_analysis_status` ON `book_analysis` (`status`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`canonical_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`aliases` text,
	`summary` text,
	`embedding` blob,
	`mention_count` integer DEFAULT 0 NOT NULL,
	`book_count` integer DEFAULT 0 NOT NULL,
	`salience` real,
	`start_year` integer,
	`end_year` integer,
	`date_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_entities_type` ON `entities` (`type`);--> statement-breakpoint
CREATE INDEX `idx_entities_normalized` ON `entities` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_entities_type_normalized` ON `entities` (`type`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `entity_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`passage_id` text NOT NULL,
	`book_id` text NOT NULL,
	`surface_text` text NOT NULL,
	`char_start` integer,
	`char_end` integer,
	`role` text,
	`confidence` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mentions_entity` ON `entity_mentions` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_mentions_passage` ON `entity_mentions` (`passage_id`);--> statement-breakpoint
CREATE INDEX `idx_mentions_book` ON `entity_mentions` (`book_id`);--> statement-breakpoint
CREATE INDEX `idx_mentions_entity_book` ON `entity_mentions` (`entity_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `entity_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`source_entity_id` text NOT NULL,
	`target_entity_id` text NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`evidence_passage_id` text,
	`book_id` text,
	`confidence` real,
	`tier` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rel_source` ON `entity_relationships` (`source_entity_id`);--> statement-breakpoint
CREATE INDEX `idx_rel_target` ON `entity_relationships` (`target_entity_id`);--> statement-breakpoint
CREATE INDEX `idx_rel_type` ON `entity_relationships` (`type`);--> statement-breakpoint
CREATE TABLE `passages` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`spine_index` integer,
	`page` integer,
	`char_start` integer,
	`char_end` integer,
	`ordinal` integer NOT NULL,
	`chapter_title` text,
	`text` text NOT NULL,
	`token_count` integer,
	`embedding` blob,
	`embedding_model` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_passages_book` ON `passages` (`book_id`);--> statement-breakpoint
CREATE INDEX `idx_passages_book_ordinal` ON `passages` (`book_id`,`ordinal`);