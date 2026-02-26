CREATE TABLE `background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0,
	`message` text,
	`payload` text,
	`result` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_background_jobs_status` ON `background_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_background_jobs_created_at` ON `background_jobs` (`created_at`);