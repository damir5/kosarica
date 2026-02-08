import 'dotenv/config';
import { getClickHouse } from '@/lib/clickhouse';

async function main() {
  const ch = getClickHouse();
  const rows = await ch.query<{ chain_slug: string; rows: number | string; items: number | string; latest: string }>(
    `SELECT
       chain_slug,
       count() AS rows,
       uniqExact(retailer_item_id) AS items,
       toString(max(target_date)) AS latest
     FROM prices
     GROUP BY chain_slug
     ORDER BY rows DESC`,
  );

  const trg = rows.find((row) => row.chain_slug === 'trgocentar') ?? null;
  console.log(JSON.stringify({ chainCount: rows.length, trgocentar: trg, top10: rows.slice(0, 10) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
