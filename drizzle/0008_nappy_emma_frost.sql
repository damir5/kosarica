CREATE TABLE "cluster_members" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"retailer_item_id" text,
	"variant_cluster_id" text,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cluster_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"from_cluster_id" text NOT NULL,
	"to_cluster_id" text NOT NULL,
	"relationship_type" text NOT NULL,
	"confidence" real,
	"reasoning" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "llm_decision_cache" (
	"input_hash" text PRIMARY KEY NOT NULL,
	"output" text NOT NULL,
	"model_plan_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_type" text NOT NULL,
	"canonical_name" text,
	"representative_retailer_item_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "retailer_item_features" (
	"id" text PRIMARY KEY NOT NULL,
	"retailer_item_id" text NOT NULL,
	"normalized_name" text NOT NULL,
	"normalized_category" text,
	"extracted_brand" text,
	"extracted_amount" real,
	"extracted_unit" text,
	"is_count_item" boolean DEFAULT false NOT NULL,
	"is_multipack" boolean DEFAULT false NOT NULL,
	"pack_amount" integer DEFAULT 1 NOT NULL,
	"unit_amount" real,
	"total_amount" real,
	"container_type" text,
	"embedding" vector(1024),
	"blocking_keys" text[],
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic_pair_decisions" (
	"item_a_id" text NOT NULL,
	"item_b_id" text NOT NULL,
	"method" text NOT NULL,
	"similarity_score" real,
	"llm_verdict" text,
	"llm_confidence" real,
	"llm_reasoning" text,
	"votes_json" text,
	"consensus_score" real,
	"human_verdict" text,
	"final_verdict" text,
	"final_confidence" real,
	"final_status" text DEFAULT 'PENDING_REVIEW' NOT NULL,
	"system_error" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_cluster_id_product_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."product_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_variant_cluster_id_product_clusters_id_fk" FOREIGN KEY ("variant_cluster_id") REFERENCES "public"."product_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_relations" ADD CONSTRAINT "cluster_relations_from_cluster_id_product_clusters_id_fk" FOREIGN KEY ("from_cluster_id") REFERENCES "public"."product_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_relations" ADD CONSTRAINT "cluster_relations_to_cluster_id_product_clusters_id_fk" FOREIGN KEY ("to_cluster_id") REFERENCES "public"."product_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_clusters" ADD CONSTRAINT "product_clusters_representative_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("representative_retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD CONSTRAINT "retailer_item_features_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_pair_decisions" ADD CONSTRAINT "semantic_pair_decisions_item_a_id_retailer_items_id_fk" FOREIGN KEY ("item_a_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_pair_decisions" ADD CONSTRAINT "semantic_pair_decisions_item_b_id_retailer_items_id_fk" FOREIGN KEY ("item_b_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_pair_decisions" ADD CONSTRAINT "semantic_pair_decisions_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cluster_members_cluster_idx" ON "cluster_members" USING btree ("cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_members_item_uniq" ON "cluster_members" USING btree ("retailer_item_id") WHERE retailer_item_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_members_variant_uniq" ON "cluster_members" USING btree ("variant_cluster_id") WHERE variant_cluster_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_members_cluster_item_unique" ON "cluster_members" USING btree ("cluster_id","retailer_item_id") WHERE retailer_item_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_members_cluster_variant_unique" ON "cluster_members" USING btree ("cluster_id","variant_cluster_id") WHERE variant_cluster_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cluster_relations_from_idx" ON "cluster_relations" USING btree ("from_cluster_id");--> statement-breakpoint
CREATE INDEX "cluster_relations_to_idx" ON "cluster_relations" USING btree ("to_cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_relations_pair_uniq" ON "cluster_relations" USING btree ("from_cluster_id","to_cluster_id");--> statement-breakpoint
CREATE INDEX "llm_decision_cache_updated_idx" ON "llm_decision_cache" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "product_clusters_type_idx" ON "product_clusters" USING btree ("cluster_type");--> statement-breakpoint
CREATE INDEX "product_clusters_representative_item_idx" ON "product_clusters" USING btree ("representative_retailer_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retailer_item_features_item_uniq" ON "retailer_item_features" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "retailer_item_features_category_brand_idx" ON "retailer_item_features" USING btree ("normalized_category","extracted_brand");--> statement-breakpoint
CREATE INDEX "retailer_item_features_unit_amount_idx" ON "retailer_item_features" USING btree ("extracted_unit","total_amount");--> statement-breakpoint
CREATE UNIQUE INDEX "semantic_pair_decisions_pair_uniq" ON "semantic_pair_decisions" USING btree ("item_a_id","item_b_id");--> statement-breakpoint
CREATE INDEX "semantic_pair_decisions_status_idx" ON "semantic_pair_decisions" USING btree ("final_status");--> statement-breakpoint
CREATE INDEX "semantic_pair_decisions_llm_verdict_idx" ON "semantic_pair_decisions" USING btree ("llm_verdict");--> statement-breakpoint
CREATE INDEX "semantic_pair_decisions_method_idx" ON "semantic_pair_decisions" USING btree ("method");