CREATE TABLE `pod_quiz_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`pod_id` text NOT NULL,
	`question_id` text NOT NULL,
	`evidence_passage_id` text NOT NULL,
	`selected_choice_id` text NOT NULL,
	`is_correct` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pod_attempts_profile` ON `pod_quiz_attempts` (`profile_id`,`created_at`);