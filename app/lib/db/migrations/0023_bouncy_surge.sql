CREATE TABLE `realm_labels` (
	`realm_key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`blurb` text,
	`model_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
