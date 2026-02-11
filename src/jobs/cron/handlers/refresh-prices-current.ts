/**
 * Refresh prices_current + prices_chain_metadata ClickHouse Tables
 *
 * Aggregates the raw `prices` table into a single-row-per-combo
 * current prices table for fast reads. Runs after daily ingestion.
 * Processes per-chain to stay within memory limits.
 */

import { getClickHouse } from "@/lib/clickhouse";
import { createLogger } from "@/utils/logger";
import type { CronExecutionContext, CronJobHandler } from "../types";

const log = createLogger("app");

const REFRESH_QUERY = `INSERT INTO prices_current
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
GROUP BY retailer_item_id, chain_slug, store_id`;

export const refreshPricesCurrentHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		log.info("Starting prices_current refresh", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			isManual: context.isManual,
		});

		const clickhouse = getClickHouse();
		const startTime = Date.now();

		// Get all chains
		const chains = await clickhouse.query<{ chain_slug: string }>(
			"SELECT DISTINCT chain_slug FROM prices ORDER BY chain_slug",
		);

		// Truncate and rebuild per-chain to avoid OOM
		await clickhouse.query("TRUNCATE TABLE prices_current");

		for (const { chain_slug } of chains) {
			await clickhouse.query(
				REFRESH_QUERY,
				{ chainSlug: chain_slug },
				{ max_execution_time: 120 },
			);
			log.info("Refreshed chain", { chain_slug, runId: context.runId });
		}

		const refreshDuration = Date.now() - startTime;

		// Refresh chain metadata
		await clickhouse.query("TRUNCATE TABLE prices_chain_metadata");
		await clickhouse.query(
			`INSERT INTO prices_chain_metadata (chain_slug, latest_date, updated_at)
			SELECT chain_slug, max(target_date), now()
			FROM prices WHERE target_date <= today()
			GROUP BY chain_slug`,
			undefined,
			{ max_execution_time: 120 },
		);

		// Verify row count
		const countRows = await clickhouse.query<{ count: string }>(
			"SELECT count() AS count FROM prices_current",
		);
		const rowCount = Number(countRows[0]?.count ?? 0);

		log.info("prices_current refresh completed", {
			runId: context.runId,
			rowCount,
			chainCount: chains.length,
			totalDurationMs: Date.now() - startTime,
		});

		return [];
	},
};
