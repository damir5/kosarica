import 'dotenv/config';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { retailerItems } from '@/db/schema';
import { getClickHouse } from '@/lib/clickhouse';
import { getDb } from '@/utils/bindings';

type PriceCountRow = { retailer_item_id: string; c: number | string };

async function main() {
  const db = getDb();
  const ch = getClickHouse();

  const items = await db
    .select({ id: retailerItems.id, name: retailerItems.name, chainSlug: retailerItems.chainSlug })
    .from(retailerItems)
    .where(and(eq(retailerItems.chainSlug, 'trgocentar'), ilike(retailerItems.name, '%coca%')))
    .limit(30);

  const ids = items.map((item) => item.id);
  const counts = ids.length > 0
    ? await ch.query<PriceCountRow>(
        `SELECT retailer_item_id, count() AS c
         FROM prices
         WHERE retailer_item_id IN ({ids:Array(String)})
         GROUP BY retailer_item_id`,
        { ids },
      )
    : [];

  const countMap = new Map(counts.map((row) => [row.retailer_item_id, Number(row.c)]));

  const enriched = items.map((item) => ({
    ...item,
    priceRows: countMap.get(item.id) ?? 0,
  }));

  console.log(JSON.stringify(enriched, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
