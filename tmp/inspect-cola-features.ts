import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT
      ri.id,
      ri.name,
      ri.brand,
      rif.pack_amount,
      rif.total_amount,
      rif.extracted_unit,
      rif.container_type,
      rif.normalized_name
    FROM retailer_items ri
    JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
    WHERE ri.merged_into_id IS NULL
      AND (
        lower(ri.name) ~ 'cola'
        OR lower(coalesce(ri.brand, '')) ~ 'cola'
      )
    ORDER BY ri.name ASC
    LIMIT 30
  `);
  const out = Array.isArray(rows) ? rows : rows.rows ?? [];
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
