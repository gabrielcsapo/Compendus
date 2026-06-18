CREATE TABLE `cs_tension_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`passage_a` text NOT NULL,
	`passage_b` text NOT NULL,
	`book_a` text NOT NULL,
	`book_b` text NOT NULL,
	`shared` text NOT NULL,
	`heuristic_score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`verdict` text,
	`tension` text,
	`stance_question` text,
	`span_a` text,
	`span_b` text,
	`model_id` text,
	`eval_label` text,
	`created_at` integer NOT NULL,
	`judged_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cs_tension_pair` ON `cs_tension_candidates` (`passage_a`,`passage_b`);--> statement-breakpoint
CREATE INDEX `idx_cs_tension_status` ON `cs_tension_candidates` (`status`);