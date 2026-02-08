import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';
import { getClickHouse } from '@/lib/clickhouse';

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

async function main() {
  const db = getDb();
  const ch = getClickHouse();

  const cocaRows = await db.execute(sql`
    SELECT id
    FROM retailer_items
    WHERE merged_into_id IS NULL
      AND (
        lower(name) ~ 'coca[ -]?cola'
        OR lower(coalesce(brand, '')) ~ 'coca[ -]?cola'
      )
  `);
  const cocaIds = getRows<{ id: string }>(cocaRows).map((row) => row.id);

  const outliers = await ch.query<{
    retailer_item_id: string;
    chain_slug: string;
    store_id: string;
    target_date: string;
    price_cents: number | string;
    discount_price_cents: number | string | null;
  }>(
    `SELECT
      retailer_item_id,
      chain_slug,
      store_id,
      toString(target_date) AS target_date,
      price_cents,
      discount_price_cents
    FROM prices
    WHERE retailer_item_id IN ({ids:Array(String)})
      AND price_cents IS NOT NULL
    ORDER BY price_cents DESC
    LIMIT 8`,
    { ids: cocaIds },
  );

  console.log(JSON.stringify({ outliers }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
