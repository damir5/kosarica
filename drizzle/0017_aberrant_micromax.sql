ALTER TABLE "store_identifiers" ADD COLUMN IF NOT EXISTS "chain_slug" text;--> statement-breakpoint
UPDATE "store_identifiers" si
SET "chain_slug" = s."chain_slug"
FROM "stores" s
WHERE s."id" = si."store_id" AND si."chain_slug" IS NULL;--> statement-breakpoint
ALTER TABLE "store_identifiers" ALTER COLUMN "chain_slug" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "store_identifiers"
    ADD CONSTRAINT "store_identifiers_chain_slug_chains_slug_fk"
    FOREIGN KEY ("chain_slug") REFERENCES "public"."chains"("slug") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_identifiers_chain_type_value_idx" ON "store_identifiers" USING btree ("chain_slug","type","value");
