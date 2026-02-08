import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT count(*)::int AS c
    FROM retailer_items
    WHERE merged_into_id IS NULL
      AND (
        lower(name) ~ 'coca[ -]?cola'
        OR lower(coalesce(brand, '')) ~ 'coca[ -]?cola'
      )
  `);
  const out = Array.isArray(rows) ? rows : rows.rows ?? [];
  console.log(JSON.stringify(out[0] ?? { c: 0 }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
