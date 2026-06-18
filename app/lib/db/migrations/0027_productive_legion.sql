CREATE INDEX `idx_fabric_devices_token_hash` ON `fabric_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_work_items_lease_expiry` ON `work_items` (`status`,`lease_until`);