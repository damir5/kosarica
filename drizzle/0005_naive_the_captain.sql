CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "products" ADD COLUMN "embedding" vector(1024);

CREATE INDEX "products_embedding_hnsw_idx"
  ON "products" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
