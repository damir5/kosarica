import { getClickHouseBatch } from "@/lib/clickhouse";
import { createLogger } from "@/utils/logger";

const log = createLogger("app");

const HEAVY_CHAIN_ROW_THRESHOLD = 15_000_000;
const HEAVY_CHAIN_BUCKET_COUNT = 8;
const REFRESH_QUERY_SETTINGS = {
	max_execution_time: 1800,
	max_bytes_before_external_group_by: 100_000_000,
	max_bytes_before_external_sort: 100_000_000,
	max_memory_usage: 8_000_000_000,
	max_threads: 4,
} as const;

const INSERT_CHAIN_QUERY = `INSERT INTO prices_current
	(retailer_item_id, chain_slug, store_id, name, brand, category,
	 external_id, barcode, price_cents, price_status, price_unavailable_reason,
	 discount_price_cents, unit_price_cents, target_date, imported_at)
SELECT
	retailer_item_id, chain_slug, store_id,
	argMax(name, target_date), argMax(brand, target_date),
	argMax(category, target_date), argMax(external_id, target_date),
	argMax(barcode, target_date), argMax(price_cents, target_date),
	argMax(price_status, target_date), argMax(price_unavailable_reason, target_date),
	argMax(discount_price_cents, target_date), argMax(unit_price_cents, target_date),
	max(target_date), now()
FROM prices
WHERE chain_slug = {chainSlug:String}
	AND target_date >= today() - 30
	AND target_date <= today()
	AND cityHash64(retailer_item_id, store_id) % {bucketCount:UInt8} = {bucket:UInt8}
GROUP BY retailer_item_id, chain_slug, store_id`;

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
		.sort();
}

export async function refreshPricesCurrentForChains(
	chainSlugs: string[],
): Promise<{ refreshedChains: string[]; totalDurationMs: number }> {
	const chains = uniqueSorted(chainSlugs);
	if (chains.length === 0) {
		return { refreshedChains: [], totalDurationMs: 0 };
	}

	const clickhouse = getClickHouseBatch();
	const startedAt = Date.now();
	const refreshedChains: string[] = [];

	for (const chainSlug of chains) {
		const chainStartedAt = Date.now();
		const rowCount = await clickhouse.query<{ count: string }>(
			`SELECT count() AS count
			FROM prices
			WHERE chain_slug = {chainSlug:String}
				AND target_date >= today() - 30
				AND target_date <= today()`,
			{ chainSlug },
		);
		const rows30d = Number(rowCount[0]?.count ?? 0);
		const bucketCount =
			Number.isFinite(rows30d) && rows30d >= HEAVY_CHAIN_ROW_THRESHOLD
				? HEAVY_CHAIN_BUCKET_COUNT
				: 1;

		await clickhouse.command(
			"DELETE FROM prices_current WHERE chain_slug = {chainSlug:String}",
			{ chainSlug },
			{ mutations_sync: "1", max_execution_time: 1800 },
		);

		for (let bucket = 0; bucket < bucketCount; bucket += 1) {
			await clickhouse.command(
				INSERT_CHAIN_QUERY,
				{ chainSlug, bucketCount, bucket },
				REFRESH_QUERY_SETTINGS,
			);
		}

		await clickhouse.command(
			"DELETE FROM prices_chain_metadata WHERE chain_slug = {chainSlug:String}",
			{ chainSlug },
			{ mutations_sync: "1", max_execution_time: 120 },
		);
		await clickhouse.command(
			`INSERT INTO prices_chain_metadata (chain_slug, latest_date, updated_at)
			SELECT chain_slug, max(target_date), now()
			FROM prices
			WHERE chain_slug = {chainSlug:String}
				AND target_date <= today()
			GROUP BY chain_slug`,
			{ chainSlug },
			{ max_execution_time: 120 },
		);

		refreshedChains.push(chainSlug);
		log.info("Refreshed prices_current for chain", {
			chainSlug,
			rows30d,
			bucketCount,
			durationMs: Date.now() - chainStartedAt,
		});
	}

	return {
		refreshedChains,
		totalDurationMs: Date.now() - startedAt,
	};
}

export async function refreshPricesCurrentForAllChains(): Promise<{
	refreshedChains: string[];
	totalDurationMs: number;
}> {
	const clickhouse = getClickHouseBatch();
	const rows = await clickhouse.query<{ chain_slug: string }>(
		`SELECT DISTINCT chain_slug
		FROM prices
		WHERE target_date >= today() - 30
			AND target_date <= today()
		ORDER BY chain_slug`,
	);
	return refreshPricesCurrentForChains(rows.map((row) => row.chain_slug));
}
