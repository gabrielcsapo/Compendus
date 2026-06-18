CREATE TABLE `cs_concept_edges` (
	`a` text NOT NULL,
	`b` text NOT NULL,
	`cooccur` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`a`, `b`)
);
--> statement-breakpoint
CREATE INDEX `idx_cs_edge_a` ON `cs_concept_edges` (`a`);--> statement-breakpoint
CREATE INDEX `idx_cs_edge_b` ON `cs_concept_edges` (`b`);--> statement-breakpoint
CREATE TABLE `cs_concept_topics` (
	`concept_id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cs_ct_topic` ON `cs_concept_topics` (`topic_id`);--> statement-breakpoint
CREATE TABLE `cs_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`display` text NOT NULL,
	`df` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cs_ingested` (
	`book_id` text PRIMARY KEY NOT NULL,
	`passage_count` integer DEFAULT 0 NOT NULL,
	`ingested_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cs_passage_concepts` (
	`passage_id` text NOT NULL,
	`concept_id` text NOT NULL,
	PRIMARY KEY(`passage_id`, `concept_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cs_pc_concept` ON `cs_passage_concepts` (`concept_id`);--> statement-breakpoint
CREATE TABLE `cs_passage_salience` (
	`passage_id` text PRIMARY KEY NOT NULL,
	`novelty` real DEFAULT 0 NOT NULL,
	`prose` real DEFAULT 0 NOT NULL,
	`salience` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cs_passage_topics` (
	`passage_id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cs_pt_topic` ON `cs_passage_topics` (`topic_id`);--> statement-breakpoint
CREATE TABLE `cs_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text,
	`size` integer DEFAULT 0 NOT NULL,
	`book_count` integer DEFAULT 0 NOT NULL
);
