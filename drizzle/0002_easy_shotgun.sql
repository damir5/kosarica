CREATE TABLE "canonical_barcodes" (
	"barcode" text PRIMARY KEY NOT NULL,
	"product_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_match_audit" (
	"id" text PRIMARY KEY NOT NULL,
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
ALTER TABLE "canonical_barcodes" ADD CONSTRAINT "canonical_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "canonical_barcodes_product_id_idx" ON "canonical_barcodes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_match_audit_queue_id_idx" ON "product_match_audit" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX "product_match_audit_action_idx" ON "product_match_audit" USING btree ("action");--> statement-breakpoint
CREATE INDEX "pmc_item_idx" ON "product_match_candidates" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "pmc_type_idx" ON "product_match_candidates" USING btree ("match_type");--> statement-breakpoint
CREATE UNIQUE INDEX "pmc_item_candidate_uniq" ON "product_match_candidates" USING btree ("retailer_item_id","candidate_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pmc_item_rank_uniq" ON "product_match_candidates" USING btree ("retailer_item_id","rank");--> statement-breakpoint
CREATE INDEX "pmq_status_idx" ON "product_match_queue" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pmq_item_uniq" ON "product_match_queue" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_match_rejections_pk" ON "product_match_rejections" USING btree ("retailer_item_id","rejected_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_item_uniq" ON "product_links" USING btree ("retailer_item_id");