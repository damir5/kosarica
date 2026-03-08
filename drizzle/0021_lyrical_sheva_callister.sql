CREATE TABLE "family_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"source_family_id" text NOT NULL,
	"target_family_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"score" real,
	"source" text DEFAULT 'graph_sync' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_relations_type_check" CHECK (relation_type IN ('quality_tier', 'formula_sibling', 'brand_line_sibling', 'taxonomy_sibling', 'adjacent_substitute'))
);
--> statement-breakpoint
CREATE TABLE "offer_variant_links" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"source" text NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_variant_links_source_check" CHECK (source IN ('graph_sync', 'manual', 'reviewed'))
);
--> statement-breakpoint
CREATE TABLE "product_families" (
	"id" text PRIMARY KEY NOT NULL,
	"family_key" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"title_normalized" text NOT NULL,
	"family_group_key" text NOT NULL,
	"taxonomy" text,
	"family_kind" text DEFAULT 'standard' NOT NULL,
	"brand_group" text,
	"core_name" text,
	"quality_label" text,
	"image_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_families_family_kind_check" CHECK (family_kind IN ('standard', 'commodity', 'fresh', 'branded', 'private_label')),
	CONSTRAINT "product_families_status_check" CHECK (status IN ('active', 'hidden', 'draft'))
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"variant_key" text NOT NULL,
	"display_name" text NOT NULL,
	"pack_label" text,
	"normalized_unit" text,
	"normalized_quantity" real,
	"pack_count" integer DEFAULT 1 NOT NULL,
	"container_type" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_collection_members" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text NOT NULL,
	"family_id" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"score" real,
	"source" text DEFAULT 'graph_sync' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"collection_type" text NOT NULL,
	"rule_key" text NOT NULL,
	"taxonomy" text,
	"brand_group" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "smart_collections_type_check" CHECK (collection_type IN ('taxonomy', 'brand', 'family_group')),
	CONSTRAINT "smart_collections_status_check" CHECK (status IN ('active', 'hidden'))
);
--> statement-breakpoint
ALTER TABLE "family_relations" ADD CONSTRAINT "family_relations_source_family_id_product_families_id_fk" FOREIGN KEY ("source_family_id") REFERENCES "public"."product_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_relations" ADD CONSTRAINT "family_relations_target_family_id_product_families_id_fk" FOREIGN KEY ("target_family_id") REFERENCES "public"."product_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_variant_links" ADD CONSTRAINT "offer_variant_links_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_variant_links" ADD CONSTRAINT "offer_variant_links_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_family_id_product_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."product_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_collection_members" ADD CONSTRAINT "smart_collection_members_collection_id_smart_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."smart_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_collection_members" ADD CONSTRAINT "smart_collection_members_family_id_product_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."product_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_relations_source_idx" ON "family_relations" USING btree ("source_family_id");--> statement-breakpoint
CREATE INDEX "family_relations_target_idx" ON "family_relations" USING btree ("target_family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "family_relations_unique" ON "family_relations" USING btree ("source_family_id","target_family_id","relation_type");--> statement-breakpoint
CREATE INDEX "offer_variant_links_variant_idx" ON "offer_variant_links" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_variant_links_item_unique" ON "offer_variant_links" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_families_family_key_unique" ON "product_families" USING btree ("family_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_families_slug_unique" ON "product_families" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "product_families_group_idx" ON "product_families" USING btree ("family_group_key");--> statement-breakpoint
CREATE INDEX "product_families_taxonomy_idx" ON "product_families" USING btree ("taxonomy");--> statement-breakpoint
CREATE INDEX "product_families_brand_idx" ON "product_families" USING btree ("brand_group");--> statement-breakpoint
CREATE INDEX "product_families_title_idx" ON "product_families" USING btree ("title_normalized");--> statement-breakpoint
CREATE INDEX "product_families_status_idx" ON "product_families" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_variants_family_idx" ON "product_variants" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_family_variant_unique" ON "product_variants" USING btree ("family_id","variant_key");--> statement-breakpoint
CREATE INDEX "smart_collection_members_collection_idx" ON "smart_collection_members" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "smart_collection_members_family_idx" ON "smart_collection_members" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "smart_collection_members_unique" ON "smart_collection_members" USING btree ("collection_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "smart_collections_slug_unique" ON "smart_collections" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "smart_collections_rule_key_unique" ON "smart_collections" USING btree ("rule_key");--> statement-breakpoint
CREATE INDEX "smart_collections_type_idx" ON "smart_collections" USING btree ("collection_type");--> statement-breakpoint
CREATE INDEX "smart_collections_taxonomy_idx" ON "smart_collections" USING btree ("taxonomy");--> statement-breakpoint
CREATE INDEX "smart_collections_brand_idx" ON "smart_collections" USING btree ("brand_group");--> statement-breakpoint
CREATE INDEX "smart_collections_status_idx" ON "smart_collections" USING btree ("status");