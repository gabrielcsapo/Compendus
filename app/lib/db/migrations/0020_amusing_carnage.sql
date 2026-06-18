CREATE TABLE `bridges` (
	`passage_a` text NOT NULL,
	`passage_b` text NOT NULL,
	`score` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bridges_pair` ON `bridges` (`passage_a`,`passage_b`);--> statement-breakpoint
CREATE INDEX `idx_bridges_a` ON `bridges` (`passage_a`);--> statement-breakpoint
CREATE TABLE `curricula` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`profile_id` text,
	`title` text,
	`builder` text NOT NULL,
	`built_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_curricula_topic` ON `curricula` (`topic_id`);--> statement-breakpoint
CREATE TABLE `curriculum_items` (
	`curriculum_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`passage_id` text NOT NULL,
	`module` text,
	`role` text,
	`transition` text,
	`question_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_curriculum_items_pk` ON `curriculum_items` (`curriculum_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `embeddings` (
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`vec` blob NOT NULL,
	`scale` real NOT NULL,
	`model` text NOT NULL,
	PRIMARY KEY(`kind`, `ref_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_embeddings_kind` ON `embeddings` (`kind`);--> statement-breakpoint
CREATE TABLE `passage_neighbors` (
	`passage_id` text NOT NULL,
	`neighbor_id` text NOT NULL,
	`score` real NOT NULL,
	`rank` integer NOT NULL,
	`cross_book` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_passage_neighbors_rank` ON `passage_neighbors` (`passage_id`,`rank`);--> statement-breakpoint
CREATE INDEX `idx_passage_neighbors_passage` ON `passage_neighbors` (`passage_id`);--> statement-breakpoint
CREATE TABLE `passage_rank` (
	`passage_id` text PRIMARY KEY NOT NULL,
	`centrality` real NOT NULL,
	`book_norm` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passage_roles` (
	`passage_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`confidence` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_passage_roles_role` ON `passage_roles` (`role`);--> statement-breakpoint
CREATE TABLE `passage_seen` (
	`profile_id` text NOT NULL,
	`passage_id` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`via` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_passage_seen_pk` ON `passage_seen` (`profile_id`,`passage_id`);--> statement-breakpoint
CREATE INDEX `idx_passage_seen_profile` ON `passage_seen` (`profile_id`);--> statement-breakpoint
CREATE TABLE `passage_topics` (
	`passage_id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_passage_topics_topic` ON `passage_topics` (`topic_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text,
	`size` integer NOT NULL,
	`book_count` integer DEFAULT 1 NOT NULL,
	`parent` text
);
--> statement-breakpoint
CREATE TABLE `trails` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`title` text NOT NULL,
	`path_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trails_profile` ON `trails` (`profile_id`);--> statement-breakpoint
ALTER TABLE `wander_sessions` ADD `path_json` text;--> statement-breakpoint
ALTER TABLE `wander_sessions` ADD `steps_taken_json` text;