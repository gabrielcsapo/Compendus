CREATE TABLE `entity_candidate_links` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_a` text NOT NULL,
	`entity_b` text NOT NULL,
	`method` text NOT NULL,
	`score` real,
	`status` text DEFAULT 'open' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`entity_a`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_b`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_candidate_pair` ON `entity_candidate_links` (`entity_a`,`entity_b`);--> statement-breakpoint
CREATE INDEX `idx_candidate_a` ON `entity_candidate_links` (`entity_a`);--> statement-breakpoint
CREATE INDEX `idx_candidate_b` ON `entity_candidate_links` (`entity_b`);--> statement-breakpoint
CREATE INDEX `idx_candidate_status` ON `entity_candidate_links` (`status`);--> statement-breakpoint
-- Identity model changed: heuristics no longer merge into entity_canonical. Reset
-- any prior heuristic merges (non-pinned) back to self; pinned human merges stay.
UPDATE `entity_canonical` SET `canonical_id` = `entity_id`, `method` = 'self', `score` = NULL WHERE `pinned` = 0;
