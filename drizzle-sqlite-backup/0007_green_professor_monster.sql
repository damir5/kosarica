ALTER TABLE `stores` ADD `is_virtual` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `stores` ADD `price_source_store_id` text REFERENCES stores(id);--> statement-breakpoint
ALTER TABLE `stores` ADD `status` text DEFAULT 'active';--> statement-breakpoint
CREATE INDEX `stores_status_idx` ON `stores` (`status`);--> statement-breakpoint
CREATE INDEX `stores_price_source_idx` ON `stores` (`price_source_store_id`);