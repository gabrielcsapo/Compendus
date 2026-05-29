CREATE TABLE `wander_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`ideas_visited` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wander_sessions_profile` ON `wander_sessions` (`profile_id`);--> statement-breakpoint
CREATE INDEX `idx_wander_sessions_started` ON `wander_sessions` (`started_at`);