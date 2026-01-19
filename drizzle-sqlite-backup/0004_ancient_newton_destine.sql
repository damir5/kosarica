CREATE INDEX `retailer_item_barcodes_barcode_idx` ON `retailer_item_barcodes` (`barcode`);--> statement-breakpoint
CREATE INDEX `retailer_items_chain_external_id_idx` ON `retailer_items` (`chain_slug`,`external_id`);--> statement-breakpoint
CREATE INDEX `retailer_items_chain_name_idx` ON `retailer_items` (`chain_slug`,`name`);--> statement-breakpoint
CREATE INDEX `store_identifiers_type_value_idx` ON `store_identifiers` (`type`,`value`);--> statement-breakpoint
CREATE INDEX `store_item_price_periods_state_idx` ON `store_item_price_periods` (`store_item_state_id`);--> statement-breakpoint
CREATE INDEX `store_item_price_periods_time_range_idx` ON `store_item_price_periods` (`started_at`,`ended_at`);--> statement-breakpoint
CREATE INDEX `store_item_state_store_retailer_idx` ON `store_item_state` (`store_id`,`retailer_item_id`);--> statement-breakpoint
CREATE INDEX `store_item_state_last_seen_idx` ON `store_item_state` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `store_item_state_price_signature_idx` ON `store_item_state` (`price_signature`);--> statement-breakpoint
CREATE INDEX `stores_chain_slug_idx` ON `stores` (`chain_slug`);--> statement-breakpoint
CREATE INDEX `stores_city_idx` ON `stores` (`city`);