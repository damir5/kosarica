ALTER TABLE `store_item_state` RENAME COLUMN `unit_price_cents` TO `unit_price`;--> statement-breakpoint
ALTER TABLE `store_item_state` RENAME COLUMN `lowest_price_30d_cents` TO `lowest_price_30d`;--> statement-breakpoint
ALTER TABLE `store_item_state` RENAME COLUMN `anchor_price_cents` TO `anchor_price`;
