CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION immutable_unaccent(TEXT)
RETURNS TEXT AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hr_normalize(input TEXT)
RETURNS TEXT AS $$
  SELECT LOWER(
    TRANSLATE(
      immutable_unaccent(COALESCE(input, '')),
      'čćđšžČĆĐŠŽ',
      'ccdjszCCDJSZ'
    )
  )
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
--> statement-breakpoint
CREATE TABLE "search_index" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"chain_slug" text,
	"category" text,
	"subcategory" text,
	"title" text NOT NULL,
	"subtitle" text,
	"body" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_index_entity_type_check" CHECK ("search_index"."entity_type" IN ('product', 'item', 'store'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "search_index_entity_unique" ON "search_index" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "search_index_entity_type_idx" ON "search_index" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "search_index_chain_slug_idx" ON "search_index" USING btree ("chain_slug");--> statement-breakpoint
CREATE INDEX "search_index_category_idx" ON "search_index" USING btree ("category");
--> statement-breakpoint
ALTER TABLE "search_index"
ADD COLUMN "title_normalized" text GENERATED ALWAYS AS (hr_normalize("title")) STORED,
ADD COLUMN "body_normalized" text GENERATED ALWAYS AS (
	hr_normalize(COALESCE("title", '') || ' ' || COALESCE("subtitle", '') || ' ' || COALESCE("body", ''))
) STORED,
ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
	setweight(to_tsvector('simple', hr_normalize(COALESCE("title", ''))), 'A') ||
	setweight(to_tsvector('simple', hr_normalize(COALESCE("subtitle", ''))), 'B') ||
	setweight(to_tsvector('simple', hr_normalize(COALESCE("body", ''))), 'C')
) STORED,
ADD COLUMN "autocomplete_text" text GENERATED ALWAYS AS (LEFT(hr_normalize("title"), 50)) STORED;
--> statement-breakpoint
CREATE INDEX "search_index_fts_idx" ON "search_index" USING GIN ("search_vector");
--> statement-breakpoint
CREATE INDEX "search_index_trgm_title_idx" ON "search_index" USING GIN ("title_normalized" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "search_index_trgm_body_idx" ON "search_index" USING GIN ("body_normalized" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "search_index_autocomplete_idx" ON "search_index" USING GIN ("autocomplete_text" gin_trgm_ops);
