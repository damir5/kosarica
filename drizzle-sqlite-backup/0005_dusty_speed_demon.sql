ALTER TABLE `store_item_state` ADD `unit_price_cents` integer;--> statement-breakpoint
ALTER TABLE `store_item_state` ADD `unit_price_base_quantity` text;--> statement-breakpoint
ALTER TABLE `store_item_state` ADD `unit_price_base_unit` text;--> statement-breakpoint
ALTER TABLE `store_item_state` ADD `lowest_price_30d_cents` integer;--> statement-breakpoint
ALTER TABLE `store_item_state` ADD `anchor_price_cents` integer;--> statement-breakpoint
ALTER TABLE `store_item_state` ADD `anchor_price_as_of` integer;