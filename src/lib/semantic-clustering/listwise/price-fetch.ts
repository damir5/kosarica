import { getClickHouse, parseNumber } from "@/lib/clickhouse";
import { createLogger } from "@/utils/logger";
import type { PriceSignal } from "./types";

const log = createLogger("matching");

interface MedianPriceRow {
	retailer_item_id: string;
	median_price: number | string | null;
	quote_count: number | string | null;
}

export async function fetchMedianPrices(
	itemIds: readonly string[],
): Promise<Map<string, PriceSignal>> {
	const uniqueIds = Array.from(
		new Set(
			itemIds
				.map((itemId) => itemId.trim())
				.filter((itemId) => itemId.length > 0),
		),
	);
	if (uniqueIds.length === 0) {
		return new Map();
	}

	try {
		const clickHouse = getClickHouse();
		const rows = await clickHouse.query<MedianPriceRow>(
			`SELECT
				retailer_item_id,
				median(if(discount_price_cents IS NOT NULL AND discount_price_cents > 0 AND discount_price_cents < price_cents, discount_price_cents, price_cents)) AS median_price,
				count() AS quote_count
			FROM prices_current
			WHERE retailer_item_id IN ({ids:Array(String)})
			GROUP BY retailer_item_id`,
			{ ids: uniqueIds },
		);

		const output = new Map<string, PriceSignal>();
		for (const row of rows) {
			const id = row.retailer_item_id?.trim();
			if (!id) {
				continue;
			}

			const medianPriceCents = parseNumber(row.median_price);
			const quoteCount = parseNumber(row.quote_count);
			if (medianPriceCents == null || quoteCount == null) {
				continue;
			}
			if (medianPriceCents <= 0 || quoteCount < 0) {
				continue;
			}

			output.set(id, {
				medianPriceCents,
				quoteCount,
			});
		}

		return output;
	} catch (error) {
		log.warn(
			"Failed to fetch median prices from ClickHouse; proceeding without price signal",
			{
				itemCount: uniqueIds.length,
				error,
			},
		);
		return new Map();
	}
}
