CREATE TABLE "container_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
INSERT INTO "container_types" ("code", "label") VALUES
	('pet', 'PET boca'),
	('limenka', 'Limenka'),
	('staklo', 'Staklo'),
	('tetrapak', 'Tetrapak'),
	('tuba', 'Tuba')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD COLUMN "everyday_name" text;--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD COLUMN "product_type" text;--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD COLUMN "search_tags" text[];--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD COLUMN "categorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD COLUMN "categorization_model" text;--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD COLUMN "categorization_confidence" real;--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD COLUMN "categorization_needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "retailer_item_features"
SET "container_type" = 'pet'
WHERE "container_type" IS NOT NULL
	AND lower("container_type") IN ('pet', 'bottle');
--> statement-breakpoint
UPDATE "retailer_item_features"
SET "container_type" = 'limenka'
WHERE "container_type" IS NOT NULL
	AND lower("container_type") IN ('can', 'limenka');
--> statement-breakpoint
UPDATE "retailer_item_features"
SET "container_type" = 'staklo'
WHERE "container_type" IS NOT NULL
	AND lower("container_type") IN ('glass', 'staklo');
--> statement-breakpoint
UPDATE "retailer_item_features"
SET "container_type" = 'tetrapak'
WHERE "container_type" IS NOT NULL
	AND lower("container_type") IN ('carton', 'tetrapak');
--> statement-breakpoint
UPDATE "retailer_item_features"
SET "container_type" = 'tuba'
WHERE "container_type" IS NOT NULL
	AND lower("container_type") IN ('tube', 'tuba');
--> statement-breakpoint
UPDATE "retailer_item_features"
SET "container_type" = NULL
WHERE "container_type" IS NOT NULL
	AND lower("container_type") NOT IN (
		'pet',
		'limenka',
		'staklo',
		'tetrapak',
		'tuba'
	);
--> statement-breakpoint
ALTER TABLE "retailer_item_features" ADD CONSTRAINT "retailer_item_features_container_type_container_types_code_fk" FOREIGN KEY ("container_type") REFERENCES "public"."container_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retailer_item_features_product_type_idx" ON "retailer_item_features" USING btree ("product_type");--> statement-breakpoint
CREATE INDEX "retailer_item_features_categorized_at_idx" ON "retailer_item_features" USING btree ("categorized_at");--> statement-breakpoint
CREATE INDEX "retailer_item_features_needs_review_idx" ON "retailer_item_features" USING btree ("categorization_needs_review");
