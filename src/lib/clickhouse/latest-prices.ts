import { chunk } from "@/lib/collections/chunk";
import { type ClickHouseClient, getClickHouse, parseNumber } from "./index";

export type LatestEffectivePriceRow = {
	retailer_item_id: string;
	effective_price: number | string | null;
};

const LATEST_EFFECTIVE_PRICE_QUERY = `SELECT
	retailer_item_id,
	argMax(
		if(discount_price_cents > 0, discount_price_cents, price_cents),
		target_date
	) AS effective_price
FROM prices_current FINAL
WHERE retailer_item_id IN ({itemIds:Array(String)})
	AND target_date >= today() - INTERVAL {days:UInt8} DAY
GROUP BY retailer_item_id`;

export async function getLatestEffectivePricesByItemId(
	itemIds: readonly string[],
	options: {
		batchSize?: number;
		includeNonPositive?: boolean;
		clickhouse?: ClickHouseClient;
		maxAgeDays?: number;
	} = {},
): Promise<Map<string, number>> {
	if (itemIds.length === 0) {
		return new Map();
	}

	const includeNonPositive = options.includeNonPositive ?? false;
	const maxAgeDays = options.maxAgeDays ?? 30;
	const batchSize =
		options.batchSize != null && options.batchSize > 0
			? options.batchSize
			: 1000;
	const clickhouse = options.clickhouse ?? getClickHouse();

	const byItemId = new Map<string, number>();
	for (const itemIdBatch of chunk(itemIds, batchSize)) {
		const rows = await clickhouse.query<LatestEffectivePriceRow>(
			LATEST_EFFECTIVE_PRICE_QUERY,
			{ itemIds: itemIdBatch, days: maxAgeDays },
		);

		for (const row of rows) {
			const price = parseNumber(row.effective_price);
			if (price == null) {
				continue;
			}
			if (!includeNonPositive && price <= 0) {
				continue;
			}
			byItemId.set(row.retailer_item_id, price);
		}
	}

	return byItemId;
}
