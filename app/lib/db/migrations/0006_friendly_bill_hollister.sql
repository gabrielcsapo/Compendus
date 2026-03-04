ALTER TABLE `books` ADD `is_read` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `books` ADD `rating` integer;--> statement-breakpoint
ALTER TABLE `books` ADD `review` text;