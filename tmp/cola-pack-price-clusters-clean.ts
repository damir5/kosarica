import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';
import { getClickHouse, parseNumber } from '@/lib/clickhouse';

type ColaItemRow = {
  id: string;
  name: string;
  brand: string | null;
  chain_slug: string | null;
  total_amount: number | null;
  pack_amount: number;
  container_type: string | null;
};

type LatestPriceRow = {
  retailer_item_id: string;
  chain_slug: string;
  store_id: string;
  effective_price: number | string | null;
  latest_date: string;
};

function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

function summarize(values: number[]): { p10: number | null; p50: number | null; p90: number | null } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p10: percentile(sorted, 10),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
  };
}

async function main() {
  const db = getDb();
  const clickhouse = getClickHouse();

  const colaItemsResult = await db.execute(sql`
    SELECT
      ri.id,
      ri.name,
      ri.brand,
      ri.chain_slug,
      rif.total_amount,
      rif.pack_amount,
      rif.container_type
    FROM retailer_items ri
    JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
    WHERE ri.merged_into_id IS NULL
      AND rif.extracted_unit = 'l'
      AND lower(ri.name) ~ '\\m(coca[- ]?cola|pepsi\\s*cola|sky\\s*cola|cola)\\M'
  `);

  const allItems = toRows<ColaItemRow>(colaItemsResult).filter((row) =>
    row.total_amount != null && Number.isFinite(row.total_amount) && row.total_amount > 0,
  );

  const plausibleItems = allItems.filter((row) =>
    (row.total_amount ?? 0) >= 0.1 && (row.total_amount ?? 0) <= 20,
  );

  const itemIds = plausibleItems.map((row) => row.id);
  if (itemIds.length === 0) {
    console.log(JSON.stringify({ message: 'No plausible cola beverage items found.' }, null, 2));
    return;
  }

  const latestPrices = await clickhouse.query<LatestPriceRow>(
    `SELECT
      retailer_item_id,
      chain_slug,
      store_id,
      argMax(if(discount_price_cents IS NULL, price_cents, discount_price_cents), target_date) AS effective_price,
      toString(max(target_date)) AS latest_date
    FROM prices
    WHERE retailer_item_id IN ({ids:Array(String)})
      AND target_date <= today()
    GROUP BY retailer_item_id, chain_slug, store_id`,
    { ids: itemIds },
  );

  const itemMap = new Map(plausibleItems.map((row) => [row.id, row]));

  const clusterByKey = new Map<string, {
    liters: number;
    packAmount: number;
    containerType: string;
    itemIds: Set<string>;
    pricesEur: number[];
    pricesPerL: number[];
    examples: Set<string>;
  }>();

  for (const quote of latestPrices) {
    const item = itemMap.get(quote.retailer_item_id);
    if (!item || item.total_amount == null || item.total_amount <= 0) continue;

    const cents = parseNumber(quote.effective_price);
    if (cents == null || cents <= 0) continue;

    const liters = round(item.total_amount, 2);
    const packAmount = item.pack_amount > 0 ? item.pack_amount : 1;
    const containerType = item.container_type ?? 'unknown';
    const key = `${liters}L|pack:${packAmount}|container:${containerType}`;

    const entry = clusterByKey.get(key) ?? {
      liters,
      packAmount,
      containerType,
      itemIds: new Set<string>(),
      pricesEur: [],
      pricesPerL: [],
      examples: new Set<string>(),
    };

    const eur = cents / 100;
    entry.itemIds.add(item.id);
    entry.pricesEur.push(eur);
    entry.pricesPerL.push(eur / liters);
    if (entry.examples.size < 3) entry.examples.add(item.name);

    clusterByKey.set(key, entry);
  }

  const clusters = Array.from(clusterByKey.entries())
    .map(([key, entry]) => {
      const priceStats = summarize(entry.pricesEur);
      const perLStats = summarize(entry.pricesPerL);
      return {
        key,
        liters: entry.liters,
        packAmount: entry.packAmount,
        containerType: entry.containerType,
        itemCount: entry.itemIds.size,
        quoteCount: entry.pricesEur.length,
        priceEurMedian: priceStats.p50 != null ? round(priceStats.p50, 2) : null,
        priceEurP10: priceStats.p10 != null ? round(priceStats.p10, 2) : null,
        priceEurP90: priceStats.p90 != null ? round(priceStats.p90, 2) : null,
        eurPerLMedian: perLStats.p50 != null ? round(perLStats.p50, 2) : null,
        eurPerLP10: perLStats.p10 != null ? round(perLStats.p10, 2) : null,
        eurPerLP90: perLStats.p90 != null ? round(perLStats.p90, 2) : null,
        examples: Array.from(entry.examples),
      };
    })
    .sort((a, b) => b.quoteCount - a.quoteCount || b.itemCount - a.itemCount);

  const suspiciousParse = allItems.filter((row) => {
    const liters = row.total_amount ?? 0;
    return liters < 0.1 || liters > 20 || ((row.pack_amount ?? 1) === 1 && liters >= 3);
  });

  const latestDateRows = await clickhouse.query<{ latest_date: string }>(
    `SELECT toString(max(target_date)) AS latest_date
    FROM prices
    WHERE retailer_item_id IN ({ids:Array(String)})`,
    { ids: itemIds },
  );

  console.log(JSON.stringify({
    scope: {
      filter: "cola drinks by name regex + extracted_unit='l'",
      matchedItemsRaw: allItems.length,
      matchedItemsPlausible: plausibleItems.length,
      pricedQuotes: latestPrices.length,
      latestPriceDate: latestDateRows[0]?.latest_date ?? null,
    },
    topClusters: clusters.slice(0, 20),
    parseQuality: {
      suspiciousCount: suspiciousParse.length,
      suspiciousSample: suspiciousParse.slice(0, 12).map((row) => ({
        id: row.id,
        name: row.name,
        totalAmountL: row.total_amount,
        packAmount: row.pack_amount,
        containerType: row.container_type,
      })),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
