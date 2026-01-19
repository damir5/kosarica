CREATE TABLE `chains` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`logo_url` text,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `ingestion_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`file_id` text,
	`entry_id` text,
	`error_type` text NOT NULL,
	`error_message` text NOT NULL,
	`error_details` text,
	`severity` text DEFAULT 'error' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `ingestion_files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`entry_id`) REFERENCES `ingestion_file_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ingestion_file_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`row_number` integer,
	`store_identifier` text,
	`item_external_id` text,
	`item_name` text,
	`price` integer,
	`discount_price` integer,
	`barcode` text,
	`raw_data` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`file_id`) REFERENCES `ingestion_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ingestion_files` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_type` text NOT NULL,
	`file_size` integer,
	`file_hash` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`entry_count` integer DEFAULT 0,
	`processed_at` integer,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_slug` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`total_files` integer DEFAULT 0,
	`processed_files` integer DEFAULT 0,
	`total_entries` integer DEFAULT 0,
	`processed_entries` integer DEFAULT 0,
	`error_count` integer DEFAULT 0,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`chain_slug`) REFERENCES `chains`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`alias` text NOT NULL,
	`source` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_links` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`retailer_item_id` text NOT NULL,
	`confidence` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`retailer_item_id`) REFERENCES `retailer_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`related_product_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`subcategory` text,
	`brand` text,
	`unit` text,
	`unit_quantity` text,
	`image_url` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `retailer_item_barcodes` (
	`id` text PRIMARY KEY NOT NULL,
	`retailer_item_id` text NOT NULL,
	`barcode` text NOT NULL,
	`is_primary` integer DEFAULT false,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`retailer_item_id`) REFERENCES `retailer_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `retailer_items` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_slug` text NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`subcategory` text,
	`brand` text,
	`unit` text,
	`unit_quantity` text,
	`image_url` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`chain_slug`) REFERENCES `chains`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_item_price_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`store_item_state_id` text NOT NULL,
	`price` integer NOT NULL,
	`discount_price` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_item_state_id`) REFERENCES `store_item_state`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_item_state` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`retailer_item_id` text NOT NULL,
	`current_price` integer,
	`previous_price` integer,
	`discount_price` integer,
	`discount_start` integer,
	`discount_end` integer,
	`in_stock` integer DEFAULT true,
	`price_signature` text,
	`last_seen_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`retailer_item_id`) REFERENCES `retailer_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_slug` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`city` text,
	`postal_code` text,
	`latitude` text,
	`longitude` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`chain_slug`) REFERENCES `chains`(`slug`) ON UPDATE no action ON DELETE cascade
);
