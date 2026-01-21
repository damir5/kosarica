CREATE TABLE "group_prices" (
	"price_group_id" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"price" integer NOT NULL,
	"discount_price" integer,
	"unit_price" integer,
	"anchor_price" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_slug" text NOT NULL,
	"price_hash" text NOT NULL,
	"hash_version" integer DEFAULT 1 NOT NULL,
	"store_count" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_group_history" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"price_group_id" text NOT NULL,
	"valid_from" timestamp NOT NULL,
	"valid_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_price_exceptions" (
	"store_id" text NOT NULL,
	"retailer_item_id" text NOT NULL,
	"price" integer NOT NULL,
	"discount_price" integer,
	"reason" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "approval_notes" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "group_prices" ADD CONSTRAINT "group_prices_price_group_id_price_groups_id_fk" FOREIGN KEY ("price_group_id") REFERENCES "public"."price_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_prices" ADD CONSTRAINT "group_prices_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_groups" ADD CONSTRAINT "price_groups_chain_slug_chains_slug_fk" FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_group_history" ADD CONSTRAINT "store_group_history_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_group_history" ADD CONSTRAINT "store_group_history_price_group_id_price_groups_id_fk" FOREIGN KEY ("price_group_id") REFERENCES "public"."price_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_exceptions" ADD CONSTRAINT "store_price_exceptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_exceptions" ADD CONSTRAINT "store_price_exceptions_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_price_exceptions" ADD CONSTRAINT "store_price_exceptions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_prices_pkey" ON "group_prices" USING btree ("price_group_id","retailer_item_id");--> statement-breakpoint
CREATE INDEX "group_prices_price_group_id_idx" ON "group_prices" USING btree ("price_group_id");--> statement-breakpoint
CREATE INDEX "group_prices_retailer_item_id_idx" ON "group_prices" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "price_groups_chain_slug_idx" ON "price_groups" USING btree ("chain_slug");--> statement-breakpoint
CREATE INDEX "price_groups_price_hash_idx" ON "price_groups" USING btree ("price_hash");--> statement-breakpoint
CREATE INDEX "price_groups_last_seen_idx" ON "price_groups" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "price_groups_store_count_idx" ON "price_groups" USING btree ("store_count");--> statement-breakpoint
CREATE UNIQUE INDEX "price_groups_chain_hash_unique" ON "price_groups" USING btree ("chain_slug","price_hash","hash_version");--> statement-breakpoint
CREATE INDEX "store_group_history_store_id_idx" ON "store_group_history" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_group_history_price_group_id_idx" ON "store_group_history" USING btree ("price_group_id");--> statement-breakpoint
CREATE INDEX "store_group_history_valid_from_idx" ON "store_group_history" USING btree ("valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "store_group_history_current" ON "store_group_history" USING btree ("store_id") WHERE valid_to IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "store_price_exceptions_pkey" ON "store_price_exceptions" USING btree ("store_id","retailer_item_id");--> statement-breakpoint
CREATE INDEX "store_price_exceptions_store_id_idx" ON "store_price_exceptions" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_price_exceptions_retailer_item_id_idx" ON "store_price_exceptions" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "store_price_exceptions_expires_at_idx" ON "store_price_exceptions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stores_approved_by_idx" ON "stores" USING btree ("approved_by");