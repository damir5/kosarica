CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "active_ingestion_operations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::TEXT NOT NULL,
	"chain_slug" text NOT NULL,
	"target_date" date NOT NULL,
	"task_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"appName" text DEFAULT 'Kosarica',
	"requireEmailVerification" boolean DEFAULT false,
	"minPasswordLength" integer DEFAULT 8,
	"maxPasswordLength" integer DEFAULT 128,
	"passkeyEnabled" boolean DEFAULT true,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archives" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_slug" text NOT NULL,
	"source_url" text NOT NULL,
	"filename" text NOT NULL,
	"original_format" text NOT NULL,
	"archive_path" text NOT NULL,
	"archive_type" text NOT NULL,
	"content_type" text,
	"file_size" bigint,
	"compressed_size" bigint,
	"is_compressed" boolean DEFAULT false,
	"checksum" text NOT NULL,
	"downloaded_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" text
);
--> statement-breakpoint
CREATE TABLE "canonical_barcodes" (
	"barcode" text PRIMARY KEY NOT NULL,
	"product_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"logo_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text DEFAULT 'UTC',
	"task_type" text NOT NULL,
	"task_payload" jsonb,
	"enabled" boolean DEFAULT true,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"error_details" text,
	"tasks_enqueued" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" bigint NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_row" integer NOT NULL,
	"end_row" integer NOT NULL,
	"row_count" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"r2_key" text,
	"persisted_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"file_id" bigint,
	"chunk_id" text,
	"entry_id" text,
	"error_type" text NOT NULL,
	"error_message" text NOT NULL,
	"error_details" text,
	"severity" text DEFAULT 'error' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer,
	"file_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"status_severity" text,
	"status_type" text,
	"entry_count" integer DEFAULT 0,
	"processed_at" timestamp,
	"metadata" text,
	"total_chunks" integer DEFAULT 0,
	"processed_chunks" integer DEFAULT 0,
	"chunk_size" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_slug" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"status_severity" text,
	"status_type" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"total_files" integer DEFAULT 0,
	"processed_files" integer DEFAULT 0,
	"total_entries" integer DEFAULT 0,
	"processed_entries" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"metadata" text,
	"archive_id" text,
	"source_url" text,
	"parent_run_id" text,
	"rerun_type" text,
	"rerun_target_id" text,
	"target_date" timestamp with time zone,
	"is_forced" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_store_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"file_id" bigint NOT NULL,
	"store_id" text NOT NULL,
	"store_identifier" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"persisted_count" integer DEFAULT 0 NOT NULL,
	"price_changes" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"warning_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "parquet_files" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_slug" text NOT NULL,
	"target_date" date NOT NULL,
	"storage_key" text NOT NULL,
	"file_size" bigint,
	"checksum" text,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"createdAt" timestamp,
	CONSTRAINT "passkey_credentialID_unique" UNIQUE("credentialID")
);
--> statement-breakpoint
CREATE TABLE "price_tiers" (
	"id" text PRIMARY KEY DEFAULT 'pt_' || gen_random_uuid()::TEXT NOT NULL,
	"chain_slug" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"price" integer NOT NULL,
	"discount_price" integer,
	"unit_price" integer,
	"anchor_price" integer,
	"target_date" date NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"store_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"alias" text NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_links" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"confidence" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_match_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"queue_id" text NOT NULL,
	"action" text NOT NULL,
	"user_id" text,
	"previous_state" text,
	"new_state" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_match_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"retailer_item_id" text NOT NULL,
	"candidate_product_id" text,
	"similarity" text,
	"match_type" text NOT NULL,
	"rank" smallint DEFAULT 1,
	"flags" text,
	"matching_run_id" text,
	"model_version" text,
	"normalized_text_hash" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_match_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"retailer_item_id" text NOT NULL,
	"status" text DEFAULT 'pending',
	"decision" text,
	"linked_product_id" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"version" integer DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_match_rejections" (
	"retailer_item_id" text NOT NULL,
	"rejected_product_id" text NOT NULL,
	"reason" text,
	"rejected_by" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"related_product_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"subcategory" text,
	"brand" text,
	"unit" text,
	"unit_quantity" text,
	"image_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "retailer_item_barcodes" (
	"id" text PRIMARY KEY NOT NULL,
	"retailer_item_id" text NOT NULL,
	"barcode" text NOT NULL,
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "retailer_items" (
	"id" text PRIMARY KEY NOT NULL,
	"retailer_item_id" integer,
	"barcode" text,
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"name" text NOT NULL,
	"external_id" text,
	"description" text,
	"brand" text,
	"category" text,
	"subcategory" text,
	"unit" text,
	"unit_quantity" text,
	"image_url" text,
	"chain_slug" text,
	"archive_id" text
);
--> statement-breakpoint
CREATE TABLE "retailer_items_failed" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_slug" text NOT NULL,
	"run_id" text,
	"file_id" bigint,
	"store_identifier" text,
	"row_number" integer,
	"raw_data" text NOT NULL,
	"validation_errors" jsonb NOT NULL,
	"failed_at" timestamp DEFAULT now(),
	"reviewed" boolean DEFAULT false,
	"reviewed_by" text,
	"review_notes" text,
	"reprocessable" boolean DEFAULT true,
	"reprocessed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "store_enrichment_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_data" text,
	"output_data" text,
	"confidence" text,
	"verified_by" text,
	"verified_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "store_identifiers" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "store_price_refs" (
	"store_id" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"price_tier_id" text NOT NULL,
	"in_stock" boolean DEFAULT true,
	"target_date" date NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_slug" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"postal_code" text,
	"latitude" text,
	"longitude" text,
	"is_virtual" boolean DEFAULT true,
	"price_source_store_id" text,
	"status" text DEFAULT 'active',
	"approval_notes" text,
	"approved_by" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_queue" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::TEXT NOT NULL,
	"task_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp DEFAULT NOW(),
	"started_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"worker_id" text,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"error_message" text,
	"parent_task_id" text,
	"expected_children" integer DEFAULT 0,
	"completed_children" integer DEFAULT 0,
	"created_at" timestamp DEFAULT NOW(),
	"updated_at" timestamp DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"role" text DEFAULT 'user',
	"banned" boolean DEFAULT false,
	"bannedAt" timestamp,
	"bannedReason" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_barcodes" ADD CONSTRAINT "canonical_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_runs" ADD CONSTRAINT "cron_runs_job_id_cron_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."cron_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_chunks" ADD CONSTRAINT "ingestion_chunks_file_id_ingestion_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ingestion_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_file_id_ingestion_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ingestion_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_chunk_id_ingestion_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."ingestion_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_files" ADD CONSTRAINT "ingestion_files_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_archive_id_archives_id_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."archives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_store_stats" ADD CONSTRAINT "ingestion_store_stats_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_store_stats" ADD CONSTRAINT "ingestion_store_stats_file_id_ingestion_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ingestion_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_store_stats" ADD CONSTRAINT "ingestion_store_stats_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parquet_files" ADD CONSTRAINT "parquet_files_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_audit" ADD CONSTRAINT "product_match_audit_queue_id_product_match_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."product_match_queue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_audit" ADD CONSTRAINT "product_match_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_candidates" ADD CONSTRAINT "product_match_candidates_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_candidates" ADD CONSTRAINT "product_match_candidates_candidate_product_id_products_id_fk" FOREIGN KEY ("candidate_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_queue" ADD CONSTRAINT "product_match_queue_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_queue" ADD CONSTRAINT "product_match_queue_linked_product_id_products_id_fk" FOREIGN KEY ("linked_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_queue" ADD CONSTRAINT "product_match_queue_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_rejections" ADD CONSTRAINT "product_match_rejections_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_rejections" ADD CONSTRAINT "product_match_rejections_rejected_product_id_products_id_fk" FOREIGN KEY ("rejected_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_rejections" ADD CONSTRAINT "product_match_rejections_rejected_by_user_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_related_product_id_products_id_fk" FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_item_barcodes" ADD CONSTRAINT "retailer_item_barcodes_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD CONSTRAINT "retailer_items_archive_id_archives_id_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."archives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_items_failed" ADD CONSTRAINT "retailer_items_failed_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_items_failed" ADD CONSTRAINT "retailer_items_failed_file_id_ingestion_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ingestion_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_enrichment_tasks" ADD CONSTRAINT "store_enrichment_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_enrichment_tasks" ADD CONSTRAINT "store_enrichment_tasks_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_identifiers" ADD CONSTRAINT "store_identifiers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_refs" ADD CONSTRAINT "store_price_refs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_refs" ADD CONSTRAINT "store_price_refs_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_refs" ADD CONSTRAINT "store_price_refs_price_tier_id_price_tiers_id_fk" FOREIGN KEY ("price_tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_price_source_store_id_stores_id_fk" FOREIGN KEY ("price_source_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_active_op" ON "active_ingestion_operations" USING btree ("chain_slug","target_date");--> statement-breakpoint
CREATE INDEX "idx_active_ops_chain_date" ON "active_ingestion_operations" USING btree ("chain_slug","target_date");--> statement-breakpoint
CREATE INDEX "idx_active_ops_task_id" ON "active_ingestion_operations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_archives_chain_slug" ON "archives" USING btree ("chain_slug");--> statement-breakpoint
CREATE INDEX "idx_archives_downloaded_at" ON "archives" USING btree ("downloaded_at");--> statement-breakpoint
CREATE INDEX "idx_archives_checksum" ON "archives" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "idx_archives_chain_downloaded" ON "archives" USING btree ("chain_slug","downloaded_at");--> statement-breakpoint
CREATE INDEX "idx_archives_run_id" ON "archives" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "canonical_barcodes_product_id_idx" ON "canonical_barcodes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "cron_jobs_next_run_idx" ON "cron_jobs" USING btree ("next_run_at") WHERE enabled = true;--> statement-breakpoint
CREATE INDEX "cron_jobs_enabled_idx" ON "cron_jobs" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "cron_runs_idempotency_idx" ON "cron_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "cron_runs_job_id_idx" ON "cron_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "cron_runs_status_idx" ON "cron_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cron_runs_job_created_idx" ON "cron_runs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "ingestion_chunks_file_chunk_idx" ON "ingestion_chunks" USING btree ("file_id","chunk_index");--> statement-breakpoint
CREATE INDEX "ingestion_chunks_status_idx" ON "ingestion_chunks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ingestion_runs_archive_id" ON "ingestion_runs" USING btree ("archive_id");--> statement-breakpoint
CREATE INDEX "idx_ingestion_runs_chain_date" ON "ingestion_runs" USING btree ("chain_slug","target_date");--> statement-breakpoint
CREATE INDEX "idx_ingestion_runs_active" ON "ingestion_runs" USING btree ("chain_slug","target_date","status");--> statement-breakpoint
CREATE INDEX "ingestion_store_stats_run_idx" ON "ingestion_store_stats" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ingestion_store_stats_file_idx" ON "ingestion_store_stats" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "ingestion_store_stats_store_idx" ON "ingestion_store_stats" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "idx_parquet_files_chain_date" ON "parquet_files" USING btree ("chain_slug","target_date");--> statement-breakpoint
CREATE UNIQUE INDEX "parquet_files_storage_key_unique" ON "parquet_files" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "parquet_files_chain_date_unique" ON "parquet_files" USING btree ("chain_slug","target_date");--> statement-breakpoint
CREATE INDEX "idx_parquet_files_imported_at" ON "parquet_files" USING btree ("imported_at");--> statement-breakpoint
CREATE INDEX "idx_price_tiers_item" ON "price_tiers" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "idx_price_tiers_chain" ON "price_tiers" USING btree ("chain_slug");--> statement-breakpoint
CREATE INDEX "idx_price_tiers_last_seen" ON "price_tiers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_price_tiers_chain_date" ON "price_tiers" USING btree ("chain_slug",target_date DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_price_tiers_unique" ON "price_tiers" USING btree ("target_date","chain_slug","retailer_item_id","price",COALESCE(discount_price, -1));--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_product_retailer_item_unique" ON "product_links" USING btree ("product_id","retailer_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_item_uniq" ON "product_links" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "product_match_audit_queue_id_idx" ON "product_match_audit" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX "product_match_audit_action_idx" ON "product_match_audit" USING btree ("action");--> statement-breakpoint
CREATE INDEX "pmc_item_idx" ON "product_match_candidates" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "pmc_type_idx" ON "product_match_candidates" USING btree ("match_type");--> statement-breakpoint
CREATE UNIQUE INDEX "pmc_item_candidate_uniq" ON "product_match_candidates" USING btree ("retailer_item_id","candidate_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pmc_item_rank_uniq" ON "product_match_candidates" USING btree ("retailer_item_id","rank");--> statement-breakpoint
CREATE INDEX "pmq_status_idx" ON "product_match_queue" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pmq_item_uniq" ON "product_match_queue" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_match_rejections_pk" ON "product_match_rejections" USING btree ("retailer_item_id","rejected_product_id");--> statement-breakpoint
CREATE INDEX "retailer_item_barcodes_retailer_item_id_idx" ON "retailer_item_barcodes" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "retailer_item_barcodes_barcode_new_idx" ON "retailer_item_barcodes" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "retailer_item_barcodes_item_barcode_unique" ON "retailer_item_barcodes" USING btree ("retailer_item_id","barcode");--> statement-breakpoint
CREATE INDEX "retailer_item_barcodes_barcode_idx" ON "retailer_items" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "idx_retailer_items_archive_id" ON "retailer_items" USING btree ("archive_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retailer_items_chain_slug_external_id_unique" ON "retailer_items" USING btree ("chain_slug","external_id");--> statement-breakpoint
CREATE INDEX "store_enrichment_tasks_store_type_idx" ON "store_enrichment_tasks" USING btree ("store_id","type");--> statement-breakpoint
CREATE INDEX "store_enrichment_tasks_status_idx" ON "store_enrichment_tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_identifiers_store_type_value_unique" ON "store_identifiers" USING btree ("store_id","type","value");--> statement-breakpoint
CREATE INDEX "store_identifiers_type_value_idx" ON "store_identifiers" USING btree ("type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "store_price_refs_pkey" ON "store_price_refs" USING btree ("target_date","store_id","retailer_item_id");--> statement-breakpoint
CREATE INDEX "idx_store_price_refs_tier" ON "store_price_refs" USING btree ("price_tier_id");--> statement-breakpoint
CREATE INDEX "idx_store_price_refs_store" ON "store_price_refs" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "idx_store_price_refs_date" ON "store_price_refs" USING btree ("target_date");--> statement-breakpoint
CREATE INDEX "stores_chain_slug_idx" ON "stores" USING btree ("chain_slug");--> statement-breakpoint
CREATE INDEX "stores_city_idx" ON "stores" USING btree ("city");--> statement-breakpoint
CREATE INDEX "stores_status_idx" ON "stores" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stores_price_source_idx" ON "stores" USING btree ("price_source_store_id");--> statement-breakpoint
CREATE INDEX "stores_approved_by_idx" ON "stores" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "idx_task_queue_status" ON "task_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_task_queue_scheduled" ON "task_queue" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_task_queue_worker" ON "task_queue" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "idx_task_queue_type_priority" ON "task_queue" USING btree ("task_type","priority","scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_task_queue_parent" ON "task_queue" USING btree ("parent_task_id") WHERE parent_task_id IS NOT NULL;
--> statement-breakpoint
-- Seed essential reference data
-- These are required for the application to function
INSERT INTO chains (slug, name, website, logo_url, created_at)
VALUES
  ('konzum', 'Konzum', 'https://www.konzum.hr', NULL, NOW()),
  ('lidl', 'Lidl', 'https://www.lidl.hr', NULL, NOW()),
  ('plodine', 'Plodine', 'https://www.plodine.hr', NULL, NOW()),
  ('interspar', 'Interspar', 'https://www.interspar.hr', NULL, NOW()),
  ('studenac', 'Studenac', 'https://www.studenac.hr', NULL, NOW()),
  ('kaufland', 'Kaufland', 'https://www.kaufland.hr', NULL, NOW()),
  ('eurospin', 'Eurospin', 'https://www.eurospin.hr', NULL, NOW()),
  ('dm', 'dm', 'https://www.dm.hr', NULL, NOW()),
  ('ktc', 'KTC', 'https://www.ktc.hr', NULL, NOW()),
  ('metro', 'Metro', 'https://www.metro.hr', NULL, NOW()),
  ('trgocentar', 'Trgocentar', 'https://www.trgocentar.hr', NULL, NOW())
ON CONFLICT (slug) DO NOTHING;