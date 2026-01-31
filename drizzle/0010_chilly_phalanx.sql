CREATE TABLE "price_tiers" (
	"id" text PRIMARY KEY DEFAULT 'pt_' || gen_random_uuid()::TEXT NOT NULL,
	"chain_slug" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"price" integer NOT NULL,
	"discount_price" integer,
	"unit_price" integer,
	"anchor_price" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"store_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_price_refs" (
	"store_id" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"price_tier_id" text NOT NULL,
	"in_stock" boolean DEFAULT true,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_queue" ADD COLUMN "parent_task_id" text;--> statement-breakpoint
ALTER TABLE "task_queue" ADD COLUMN "expected_children" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "task_queue" ADD COLUMN "completed_children" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_refs" ADD CONSTRAINT "store_price_refs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_refs" ADD CONSTRAINT "store_price_refs_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_refs" ADD CONSTRAINT "store_price_refs_price_tier_id_price_tiers_id_fk" FOREIGN KEY ("price_tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_price_tiers_item" ON "price_tiers" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "idx_price_tiers_chain" ON "price_tiers" USING btree ("chain_slug");--> statement-breakpoint
CREATE INDEX "idx_price_tiers_last_seen" ON "price_tiers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_price_tiers_unique" ON "price_tiers" USING btree ("chain_slug","retailer_item_id","price",COALESCE(discount_price, -1));--> statement-breakpoint
CREATE UNIQUE INDEX "store_price_refs_pkey" ON "store_price_refs" USING btree ("store_id","retailer_item_id");--> statement-breakpoint
CREATE INDEX "idx_store_price_refs_tier" ON "store_price_refs" USING btree ("price_tier_id");--> statement-breakpoint
CREATE INDEX "idx_store_price_refs_store" ON "store_price_refs" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "idx_task_queue_parent" ON "task_queue" USING btree ("parent_task_id") WHERE parent_task_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "task_queue" DROP CONSTRAINT IF EXISTS task_queue_status_check;--> statement-breakpoint
ALTER TABLE "task_queue" ADD CONSTRAINT task_queue_status_check CHECK (status = ANY (ARRAY['pending'::text, 'claimed'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'waiting_for_children'::text]));--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.on_subtask_complete() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.parent_task_id IS NOT NULL THEN
    UPDATE task_queue
    SET completed_children = completed_children + 1,
        updated_at = NOW()
    WHERE id = NEW.parent_task_id;

    UPDATE task_queue
    SET status = 'pending', scheduled_for = NOW()
    WHERE id = NEW.parent_task_id
      AND status = 'waiting_for_children'
      AND completed_children >= expected_children;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS subtask_completion_trigger ON public.task_queue;--> statement-breakpoint
CREATE TRIGGER subtask_completion_trigger
  AFTER UPDATE OF status ON public.task_queue
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.on_subtask_complete();