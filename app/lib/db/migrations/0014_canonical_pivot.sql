CREATE TABLE `entity_canonical` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`canonical_id` text NOT NULL,
	`method` text DEFAULT 'self' NOT NULL,
	`score` real,
	`pinned` integer DEFAULT false NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`canonical_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_canonical_canonical` ON `entity_canonical` (`canonical_id`);--> statement-breakpoint
CREATE INDEX `idx_canonical_excluded` ON `entity_canonical` (`excluded`);--> statement-breakpoint
-- One-time reset: the extraction layer now uses deterministic stable ids and an
-- insert-only resolver, so prior randomly-keyed graph rows are incompatible.
-- Only a few books had been analyzed; wipe the graph so re-analysis rebuilds it
-- cleanly under the new model. Books/passages source files are untouched.
DELETE FROM `entity_relationships`;--> statement-breakpoint
DELETE FROM `entity_mentions`;--> statement-breakpoint
DELETE FROM `entities`;--> statement-breakpoint
DELETE FROM `book_analysis`;--> statement-breakpoint
-- Resolved-mentions view: the read-side projection of the graph through the
-- canonical mapping. Every mention is attributed to its canonical entity, and
-- mentions of excluded (noise) entities are dropped. Read queries (wander,
-- co-occurrence, entity detail) select from this instead of entity_mentions so
-- identity changes require no query rewrites — just a mapping rebuild.
CREATE VIEW `canonical_mentions` AS
SELECT m.id AS id,
       c.canonical_id AS entity_id,
       m.entity_id AS raw_entity_id,
       m.passage_id AS passage_id,
       m.book_id AS book_id,
       m.surface_text AS surface_text,
       m.char_start AS char_start,
       m.char_end AS char_end,
       m.role AS role,
       m.confidence AS confidence
FROM entity_mentions m
JOIN entity_canonical c ON c.entity_id = m.entity_id
WHERE c.excluded = 0;
