CREATE TABLE `curated_discovery` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`prompt_version` text NOT NULL,
	`model_id` text,
	`generated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_curated_discovery_expires` ON `curated_discovery` (`expires_at`);