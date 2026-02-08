CREATE TABLE "barcode_sku_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"barcode" text NOT NULL,
	"canonical_sku_id" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barcode_sku_mappings_confidence_check" CHECK (confidence >= 0 AND confidence <= 1),
	CONSTRAINT "barcode_sku_mappings_source_check" CHECK (source IN ('barcode_cluster', 'llm', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "barcode_triage_claims" (
	"barcode" text PRIMARY KEY NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "canonical_skus" (
	"id" text PRIMARY KEY NOT NULL,
	"base_product_id" text,
	"merged_into_id" text,
	"canonical_name" text NOT NULL,
	"everyday_name" text,
	"brand" text,
	"product_type" text,
	"normalized_unit" text,
	"normalized_quantity" real,
	"pack_amount" integer DEFAULT 1 NOT NULL,
	"container_type" text,
	"is_base_product" boolean DEFAULT false NOT NULL,
	"match_policy" text DEFAULT 'matchable' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_skus_match_policy_check" CHECK (match_policy IN ('matchable', 'private_label', 'non_comparable')),
	CONSTRAINT "canonical_skus_status_check" CHECK (status IN ('draft', 'active', 'merged', 'deprecated')),
	CONSTRAINT "canonical_skus_base_product_invariant_check" CHECK ((is_base_product = false) OR base_product_id IS NULL),
	CONSTRAINT "canonical_skus_active_variant_base_check" CHECK ((is_base_product = true) OR (status <> 'active') OR (base_product_id IS NOT NULL)),
	CONSTRAINT "canonical_skus_merged_status_target_check" CHECK ((status <> 'merged') OR (merged_into_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "catalog_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_decision_log" (
	"id" text PRIMARY KEY NOT NULL,
	"task_type" text NOT NULL,
	"input_hash" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"latency_ms" integer,
	"token_count" integer,
	"cost_cents" integer,
	"verdict" text,
	"confidence" real,
	"reasoning" text,
	"human_override" text,
	"human_notes" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_decision_log_confidence_check" CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
--> statement-breakpoint
CREATE TABLE "sku_item_links" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_sku_id" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"link_type" text NOT NULL,
	"confidence" real,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_item_links_confidence_check" CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
	CONSTRAINT "sku_item_links_link_type_check" CHECK (link_type IN ('barcode', 'llm', 'manual', 'feature_match'))
);
--> statement-breakpoint
DROP INDEX "retailer_item_barcodes_barcode_idx";--> statement-breakpoint
ALTER TABLE "retailer_item_barcodes" ADD COLUMN "barcode_class" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "barcode_sku_mappings" ADD CONSTRAINT "barcode_sku_mappings_canonical_sku_id_canonical_skus_id_fk" FOREIGN KEY ("canonical_sku_id") REFERENCES "public"."canonical_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barcode_sku_mappings" ADD CONSTRAINT "barcode_sku_mappings_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barcode_sku_mappings" ADD CONSTRAINT "barcode_sku_mappings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barcode_triage_claims" ADD CONSTRAINT "barcode_triage_claims_claimed_by_user_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_skus" ADD CONSTRAINT "canonical_skus_base_product_id_canonical_skus_id_fk" FOREIGN KEY ("base_product_id") REFERENCES "public"."canonical_skus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_skus" ADD CONSTRAINT "canonical_skus_merged_into_id_canonical_skus_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."canonical_skus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_skus" ADD CONSTRAINT "canonical_skus_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_events" ADD CONSTRAINT "catalog_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_decision_log" ADD CONSTRAINT "llm_decision_log_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_item_links" ADD CONSTRAINT "sku_item_links_canonical_sku_id_canonical_skus_id_fk" FOREIGN KEY ("canonical_sku_id") REFERENCES "public"."canonical_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_item_links" ADD CONSTRAINT "sku_item_links_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_item_links" ADD CONSTRAINT "sku_item_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "barcode_sku_mappings_barcode_unique" ON "barcode_sku_mappings" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "barcode_sku_mappings_sku_idx" ON "barcode_sku_mappings" USING btree ("canonical_sku_id");--> statement-breakpoint
CREATE INDEX "barcode_sku_mappings_source_idx" ON "barcode_sku_mappings" USING btree ("source");--> statement-breakpoint
CREATE INDEX "barcode_sku_mappings_verified_by_idx" ON "barcode_sku_mappings" USING btree ("verified_by");--> statement-breakpoint
CREATE INDEX "barcode_triage_claims_expires_at_idx" ON "barcode_triage_claims" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "barcode_triage_claims_claimed_by_idx" ON "barcode_triage_claims" USING btree ("claimed_by");--> statement-breakpoint
CREATE INDEX "canonical_skus_base_product_idx" ON "canonical_skus" USING btree ("base_product_id");--> statement-breakpoint
CREATE INDEX "canonical_skus_merged_into_idx" ON "canonical_skus" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "canonical_skus_status_idx" ON "canonical_skus" USING btree ("status");--> statement-breakpoint
CREATE INDEX "canonical_skus_match_policy_idx" ON "canonical_skus" USING btree ("match_policy");--> statement-breakpoint
CREATE INDEX "canonical_skus_active_name_idx" ON "canonical_skus" USING btree ("canonical_name") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "catalog_events_entity_created_at_idx" ON "catalog_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_events_event_type_created_at_idx" ON "catalog_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "llm_decision_log_created_at_idx" ON "llm_decision_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_decision_log_task_type_created_at_idx" ON "llm_decision_log" USING btree ("task_type","created_at");--> statement-breakpoint
CREATE INDEX "llm_decision_log_model_created_at_idx" ON "llm_decision_log" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_decision_log_input_hash_idx" ON "llm_decision_log" USING btree ("input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sku_item_links_item_unique" ON "sku_item_links" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sku_item_links_sku_item_unique" ON "sku_item_links" USING btree ("canonical_sku_id","retailer_item_id");--> statement-breakpoint
CREATE INDEX "sku_item_links_sku_idx" ON "sku_item_links" USING btree ("canonical_sku_id");--> statement-breakpoint
CREATE INDEX "sku_item_links_link_type_idx" ON "sku_item_links" USING btree ("link_type");--> statement-breakpoint
CREATE INDEX "retailer_item_barcodes_barcode_class_idx" ON "retailer_item_barcodes" USING btree ("barcode_class");--> statement-breakpoint
ALTER TABLE "retailer_items" DROP COLUMN "retailer_item_id";--> statement-breakpoint
ALTER TABLE "retailer_items" DROP COLUMN "barcode";--> statement-breakpoint
CREATE MATERIALIZED VIEW "barcode_triage_queue" AS
WITH barcode_items AS (
	SELECT
		rib.barcode,
		ri.chain_slug,
		COALESCE(rif.normalized_category, 'uncategorized') AS category
	FROM retailer_item_barcodes rib
	JOIN retailer_items ri ON ri.id = rib.retailer_item_id
	LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = rib.retailer_item_id
	WHERE rib.barcode_class NOT IN ('variable_weight', 'internal_code')
),
category_counts AS (
	SELECT
		barcode,
		category,
		COUNT(*)::int AS category_count
	FROM barcode_items
	GROUP BY barcode, category
),
barcode_groups AS (
	SELECT
		bi.barcode,
		COUNT(*)::int AS item_count,
		COUNT(DISTINCT bi.chain_slug)::int AS chain_count,
		MAX(cc.category_count)::int AS max_category_count
	FROM barcode_items bi
	JOIN category_counts cc
		ON cc.barcode = bi.barcode
		AND cc.category = bi.category
	GROUP BY bi.barcode
)
SELECT
	bg.barcode,
	bg.chain_count,
	bg.item_count,
	CASE
		WHEN bg.item_count > 0 THEN bg.max_category_count::real / bg.item_count::real
		ELSE 0
	END AS category_agreement,
	NULL::real AS price_variance,
	(
		bg.chain_count * 20
		+ bg.item_count * 4
		+ ROUND(
			(
				CASE
					WHEN bg.item_count > 0 THEN bg.max_category_count::real / bg.item_count::real
					ELSE 0
				END
			) * 20
		)::int
		+ 8
	)::int AS priority_score
FROM barcode_groups bg
WHERE bg.chain_count >= 2
	AND NOT EXISTS (
		SELECT 1
		FROM barcode_sku_mappings bsm
		WHERE bsm.barcode = bg.barcode
	)
ORDER BY priority_score DESC;--> statement-breakpoint
CREATE UNIQUE INDEX "barcode_triage_queue_barcode_unique_idx"
	ON "barcode_triage_queue" ("barcode");--> statement-breakpoint
CREATE INDEX "barcode_triage_queue_priority_idx"
	ON "barcode_triage_queue" ("priority_score" DESC);
