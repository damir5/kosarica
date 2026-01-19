CREATE TABLE `ingestion_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`start_row` integer NOT NULL,
	`end_row` integer NOT NULL,
	`row_count` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`r2_key` text,
	`persisted_count` integer DEFAULT 0,
	`error_count` integer DEFAULT 0,
	`processed_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`file_id`) REFERENCES `ingestion_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ingestion_chunks_file_chunk_idx` ON `ingestion_chunks` (`file_id`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `ingestion_chunks_status_idx` ON `ingestion_chunks` (`status`);--> statement-breakpoint
CREATE TABLE `store_enrichment_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input_data` text,
	`output_data` text,
	`confidence` text,
	`verified_by` text,
	`verified_at` integer,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`verified_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `store_enrichment_tasks_store_type_idx` ON `store_enrichment_tasks` (`store_id`,`type`);--> statement-breakpoint
CREATE INDEX `store_enrichment_tasks_status_idx` ON `store_enrichment_tasks` (`status`);--> statement-breakpoint
ALTER TABLE `ingestion_errors` ADD `chunk_id` text REFERENCES ingestion_chunks(id);--> statement-breakpoint
ALTER TABLE `ingestion_files` ADD `total_chunks` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `ingestion_files` ADD `processed_chunks` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `ingestion_files` ADD `chunk_size` integer;--> statement-breakpoint
ALTER TABLE `ingestion_runs` ADD `parent_run_id` text;--> statement-breakpoint
ALTER TABLE `ingestion_runs` ADD `rerun_type` text;--> statement-breakpoint
ALTER TABLE `ingestion_runs` ADD `rerun_target_id` text;