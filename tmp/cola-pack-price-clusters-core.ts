import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';
import { getClickHouse, parseNumber } from '@/lib/clickhouse';

type ColaItemRow = {
  id: string;
  name: string;
  total_amount: number | null;
  pack_amount: number;
  container_type: string | null;
};

type LatestPriceRow = {
  retailer_item_id: string;
  effective_price: number | string | null;
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

function summarize(values: number[]) {
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

  const itemsResult = await db.execute(sql`
    SELECT
      ri.id,
      ri.name,
      rif.total_amount,
      rif.pack_amount,
      rif.container_type
    FROM retailer_items ri
    JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
    WHERE ri.merged_into_id IS NULL
      AND rif.extracted_unit = 'l'
      AND lower(ri.name) ~ '\\m(coca[- ]?cola|pepsi\\s*cola|sky\\s*cola|cola)\\M'
      AND lower(ri.name) !~ '(sprite|fanta|schweppes|cappy|burn|monster|powerade|fuzetea|smartwater|romerquelle|sladoled|liker|cocktail|jameson|malibu|jim beam)'
  `);

  const rawItems = toRows<ColaItemRow>(itemsResult);
  const items = rawItems.filter((row) =>
    row.total_amount != null && row.total_amount >= 0.1 && row.total_amount <= 20,
  );

  const ids = items.map((row) => row.id);

  const latest = await clickhouse.query<LatestPriceRow>(
    `SELECT
      retailer_item_id,
      argMax(if(discount_price_cents IS NULL, price_cents, discount_price_cents), target_date) AS effective_price
    FROM prices
    WHERE retailer_item_id IN ({ids:Array(String)})
      AND target_date <= today()
    GROUP BY retailer_item_id, chain_slug, store_id`,
    { ids },
  );

  const itemById = new Map(items.map((item) => [item.id, item]));
  const clusters = new Map<string, { itemIds: Set<string>; prices: number[]; perL: number[] }>();

  for (const row of latest) {
    const item = itemById.get(row.retailer_item_id);
    if (!item || !item.total_amount) continue;
    const cents = parseNumber(row.effective_price);
    if (cents == null || cents <= 0) continue;

    const liters = round(item.total_amount, 2);
    const pack = item.pack_amount > 0 ? item.pack_amount : 1;
    const key = `${liters}L|pack:${pack}`;

    const e = clusters.get(key) ?? { itemIds: new Set<string>(), prices: [], perL: [] };
    const eur = cents / 100;
    e.itemIds.add(item.id);
    e.prices.push(eur);
    e.perL.push(eur / liters);
    clusters.set(key, e);
  }

  const out = Array.from(clusters.entries())
    .map(([key, value]) => {
      const p = summarize(value.prices);
      const l = summarize(value.perL);
      return {
        key,
        itemCount: value.itemIds.size,
        quoteCount: value.prices.length,
        priceMedian: p.p50 != null ? round(p.p50, 2) : null,
        priceP10: p.p10 != null ? round(p.p10, 2) : null,
        priceP90: p.p90 != null ? round(p.p90, 2) : null,
        eurPerLMedian: l.p50 != null ? round(l.p50, 2) : null,
        eurPerLP10: l.p10 != null ? round(l.p10, 2) : null,
        eurPerLP90: l.p90 != null ? round(l.p90, 2) : null,
      };
    })
    .sort((a, b) => b.quoteCount - a.quoteCount || b.itemCount - a.itemCount);

  console.log(JSON.stringify({
    scope: {
      rawItems: rawItems.length,
      plausibleItems: items.length,
      quotes: latest.length,
    },
    top: out.slice(0, 15),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
