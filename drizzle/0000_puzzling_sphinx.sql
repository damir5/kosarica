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
CREATE TABLE "chains" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"logo_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"file_id" text,
	"chunk_id" text,
	"entry_id" text,
	"error_type" text NOT NULL,
	"error_message" text NOT NULL,
	"error_details" text,
	"severity" text DEFAULT 'error' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_file_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"row_number" integer,
	"store_identifier" text,
	"item_external_id" text,
	"item_name" text,
	"price" integer,
	"discount_price" integer,
	"barcode" text,
	"raw_data" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_files" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer,
	"file_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
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
	"started_at" timestamp,
	"completed_at" timestamp,
	"total_files" integer DEFAULT 0,
	"processed_files" integer DEFAULT 0,
	"total_entries" integer DEFAULT 0,
	"processed_entries" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"metadata" text,
	"parent_run_id" text,
	"rerun_type" text,
	"rerun_target_id" text,
	"created_at" timestamp DEFAULT now()
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
	"chain_slug" text NOT NULL,
	"external_id" text,
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
CREATE TABLE "store_item_price_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"store_item_state_id" text NOT NULL,
	"price" integer NOT NULL,
	"discount_price" integer,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "store_item_state" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"current_price" integer,
	"previous_price" integer,
	"discount_price" integer,
	"discount_start" timestamp,
	"discount_end" timestamp,
	"in_stock" boolean DEFAULT true,
	"unit_price" integer,
	"unit_price_base_quantity" text,
	"unit_price_base_unit" text,
	"lowest_price_30d" integer,
	"anchor_price" integer,
	"anchor_price_as_of" timestamp,
	"price_signature" text,
	"last_seen_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
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
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
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
ALTER TABLE "ingestion_chunks" ADD CONSTRAINT "ingestion_chunks_file_id_ingestion_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ingestion_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_file_id_ingestion_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ingestion_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_chunk_id_ingestion_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."ingestion_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_entry_id_ingestion_file_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ingestion_file_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_file_entries" ADD CONSTRAINT "ingestion_file_entries_file_id_ingestion_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ingestion_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_files" ADD CONSTRAINT "ingestion_files_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_related_product_id_products_id_fk" FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_item_barcodes" ADD CONSTRAINT "retailer_item_barcodes_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD CONSTRAINT "retailer_items_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_enrichment_tasks" ADD CONSTRAINT "store_enrichment_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_enrichment_tasks" ADD CONSTRAINT "store_enrichment_tasks_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_identifiers" ADD CONSTRAINT "store_identifiers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_item_price_periods" ADD CONSTRAINT "store_item_price_periods_store_item_state_id_store_item_state_id_fk" FOREIGN KEY ("store_item_state_id") REFERENCES "public"."store_item_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_item_state" ADD CONSTRAINT "store_item_state_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_item_state" ADD CONSTRAINT "store_item_state_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_price_source_store_id_stores_id_fk" FOREIGN KEY ("price_source_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_chunks_file_chunk_idx" ON "ingestion_chunks" USING btree ("file_id","chunk_index");--> statement-breakpoint
CREATE INDEX "ingestion_chunks_status_idx" ON "ingestion_chunks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_product_retailer_item_unique" ON "product_links" USING btree ("product_id","retailer_item_id");--> statement-breakpoint
CREATE INDEX "retailer_item_barcodes_barcode_idx" ON "retailer_item_barcodes" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "retailer_items_chain_external_id_idx" ON "retailer_items" USING btree ("chain_slug","external_id");--> statement-breakpoint
CREATE INDEX "retailer_items_chain_name_idx" ON "retailer_items" USING btree ("chain_slug","name");--> statement-breakpoint
CREATE INDEX "store_enrichment_tasks_store_type_idx" ON "store_enrichment_tasks" USING btree ("store_id","type");--> statement-breakpoint
CREATE INDEX "store_enrichment_tasks_status_idx" ON "store_enrichment_tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_identifiers_store_type_value_unique" ON "store_identifiers" USING btree ("store_id","type","value");--> statement-breakpoint
CREATE INDEX "store_identifiers_type_value_idx" ON "store_identifiers" USING btree ("type","value");--> statement-breakpoint
CREATE INDEX "store_item_price_periods_state_idx" ON "store_item_price_periods" USING btree ("store_item_state_id");--> statement-breakpoint
CREATE INDEX "store_item_price_periods_time_range_idx" ON "store_item_price_periods" USING btree ("started_at","ended_at");--> statement-breakpoint
CREATE INDEX "store_item_state_store_retailer_idx" ON "store_item_state" USING btree ("store_id","retailer_item_id");--> statement-breakpoint
CREATE INDEX "store_item_state_last_seen_idx" ON "store_item_state" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "store_item_state_price_signature_idx" ON "store_item_state" USING btree ("price_signature");--> statement-breakpoint
CREATE INDEX "stores_chain_slug_idx" ON "stores" USING btree ("chain_slug");--> statement-breakpoint
CREATE INDEX "stores_city_idx" ON "stores" USING btree ("city");--> statement-breakpoint
CREATE INDEX "stores_status_idx" ON "stores" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stores_price_source_idx" ON "stores" USING btree ("price_source_store_id");