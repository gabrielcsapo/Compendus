CREATE TABLE `fabric_artifacts` (
	`hash` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`model_id` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`path` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fabric_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`token_hash` text NOT NULL,
	`last_seen` integer,
	`jobs_done` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`requirements` text DEFAULT '{}' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`deadline` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`lease_owner` text,
	`lease_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`result` text,
	`error` text,
	`artifact_hash` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`lease_owner`) REFERENCES `fabric_devices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`artifact_hash`) REFERENCES `fabric_artifacts`(`hash`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_work_items_status` ON `work_items` (`status`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_work_items_idempotency` ON `work_items` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_work_items_kind` ON `work_items` (`kind`);