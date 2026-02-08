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
    ORDER BY id ASC
  `);
  const cocaIds = getRows<{ id: string }>(cocaRows).map((row) => row.id);

  if (cocaIds.length === 0) {
    console.log(JSON.stringify({ cocaItems: 0 }, null, 2));
    return;
  }

  const coverage = await ch.query<{
    rows: number | string;
    unique_items: number | string;
    unique_stores: number | string;
    unique_chains: number | string;
    min_date: string | null;
    max_date: string | null;
  }>(
    `SELECT
      count() AS rows,
      uniqExact(retailer_item_id) AS unique_items,
      uniqExact(store_id) AS unique_stores,
      uniqExact(chain_slug) AS unique_chains,
      toString(min(target_date)) AS min_date,
      toString(max(target_date)) AS max_date
    FROM prices
    WHERE retailer_item_id IN ({ids:Array(String)})`,
    { ids: cocaIds },
  );

  const latestDist = await ch.query<{
    latest_date: string;
    stores: number | string;
  }>(
    `SELECT
      toString(max(target_date)) AS latest_date,
      count() AS stores
    FROM prices
    WHERE retailer_item_id IN ({ids:Array(String)})
    GROUP BY store_id
    ORDER BY latest_date DESC
    LIMIT 10`,
    { ids: cocaIds },
  );

  const priceStats = await ch.query<{
    min_price: number | string | null;
    p50_price: number | string | null;
    p90_price: number | string | null;
    max_price: number | string | null;
  }>(
    `SELECT
      min(price_cents) AS min_price,
      quantileExact(0.5)(price_cents) AS p50_price,
      quantileExact(0.9)(price_cents) AS p90_price,
      max(price_cents) AS max_price
    FROM prices
    WHERE retailer_item_id IN ({ids:Array(String)})
      AND price_cents IS NOT NULL`,
    { ids: cocaIds },
  );

  const byChain = await ch.query<{
    chain_slug: string;
    rows: number | string;
    items: number | string;
    stores: number | string;
    latest: string;
  }>(
    `SELECT
      chain_slug,
      count() AS rows,
      uniqExact(retailer_item_id) AS items,
      uniqExact(store_id) AS stores,
      toString(max(target_date)) AS latest
    FROM prices
    WHERE retailer_item_id IN ({ids:Array(String)})
    GROUP BY chain_slug
    ORDER BY rows DESC`,
    { ids: cocaIds },
  );

  console.log(
    JSON.stringify(
      {
        cocaItems: cocaIds.length,
        coverage: coverage[0] ?? null,
        priceStats: priceStats[0] ?? null,
        byChain,
        latestStoreDatesTop10: latestDist,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
