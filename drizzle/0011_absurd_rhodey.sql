CREATE INDEX "retailer_item_features_updated_at_idx" ON "retailer_item_features" USING btree ("updated_at");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_item_features_embedding_hnsw_idx"
  ON "retailer_item_features" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE "embedding" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_item_features_normalized_name_trgm_gist_idx"
  ON "retailer_item_features" USING gist ("normalized_name" gist_trgm_ops);
