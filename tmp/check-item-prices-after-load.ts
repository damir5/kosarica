import 'dotenv/config';
import { getClickHouse } from '@/lib/clickhouse';

async function main() {
  const id = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';
  const ch = getClickHouse();

  const countRows = await ch.query<{ c: number | string }>(
    `SELECT count() AS c
     FROM prices
     WHERE retailer_item_id = {id:String}`,
    { id },
  );

  const latestRows = await ch.query<{
    chain_slug: string;
    store_id: string;
    current_price: number | string | null;
    discount_price: number | string | null;
    last_seen_at: string;
  }>(
    `SELECT
       chain_slug,
       store_id,
       argMax(price_cents, target_date) AS current_price,
       argMax(discount_price_cents, target_date) AS discount_price,
       toString(max(target_date)) AS last_seen_at
     FROM prices
     WHERE retailer_item_id = {id:String}
       AND target_date <= today()
     GROUP BY chain_slug, store_id
     ORDER BY last_seen_at DESC`,
    { id },
  );

  console.log(JSON.stringify({ id, rows: Number(countRows[0]?.c ?? 0), latestRows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
