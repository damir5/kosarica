/**
 * Refresh prices_current + prices_chain_metadata ClickHouse Tables
 *
 * Aggregates the raw `prices` table into a single-row-per-combo
 * current prices table for fast reads. Runs after daily ingestion.
 * Processes per-chain to stay within memory limits.
 *
 * Uses a staging-table swap to avoid leaving partial data on failure:
 * 1. Sync any pending parquet files into the raw `prices` table
 * 2. Create a staging table (same schema as prices_current)
 * 3. INSERT per-chain aggregations into the staging table
 * 4. Atomically EXCHANGE the staging and live tables
 * 5. Drop the old table
 *
 * If any step fails before the EXCHANGE, the live table is untouched.
 */

import { getClickHouseBatch } from "@/lib/clickhouse";
import { loadMissingToClickHouse } from "@/ingestion/clickhouse-sync";
import { createLogger } from "@/utils/logger";
import type { CronExecutionContext, CronJobHandler } from "../types";

const log = createLogger("app");

const STAGING_TABLE = "prices_current_staging";

const REFRESH_QUERY = `INSERT INTO ${STAGING_TABLE}
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

async function dropTableIfExists(
	ch: ReturnType<typeof getClickHouseBatch>,
	table: string,
): Promise<void> {
	await ch.command(`DROP TABLE IF EXISTS ${table}`);
}

export const refreshPricesCurrentHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		log.info("Starting prices_current refresh", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			isManual: context.isManual,
		});

		const clickhouse = getClickHouseBatch();
		const startTime = Date.now();

		// Step 0: Sync pending parquet files so the raw prices table is up-to-date
		try {
			const syncResult = await loadMissingToClickHouse();
			log.info("Synced pending parquet files before refresh", {
				imported: syncResult.imported,
				pending: syncResult.pending,
				runId: context.runId,
			});
		} catch (syncError) {
			log.warn("Parquet sync failed, continuing with existing data", {
				error: syncError,
				runId: context.runId,
			});
		}

		// Step 1: Get all chains from the raw prices table
		const chains = await clickhouse.query<{ chain_slug: string }>(
			"SELECT DISTINCT chain_slug FROM prices ORDER BY chain_slug",
		);

		if (chains.length === 0) {
			log.warn("No chains found in prices table, skipping refresh", {
				runId: context.runId,
			});
			return [];
		}

		// Step 2: Prepare staging table (drop if leftover from a previous failed run)
		await dropTableIfExists(clickhouse, STAGING_TABLE);
		await clickhouse.command(
			`CREATE TABLE ${STAGING_TABLE} AS prices_current`,
		);

		// Step 3: Populate staging table per-chain
		let chainsProcessed = 0;
		try {
			for (const { chain_slug } of chains) {
				const chainStart = Date.now();
				await clickhouse.command(
					REFRESH_QUERY,
					{ chainSlug: chain_slug },
					{ max_execution_time: 1800 },
				);
				chainsProcessed += 1;
				log.info("Refreshed chain into staging table", {
					chain_slug,
					chainsProcessed,
					totalChains: chains.length,
					durationMs: Date.now() - chainStart,
					runId: context.runId,
				});
			}
		} catch (chainError) {
			// Cleanup staging table — live table is untouched
			log.error("Chain refresh failed, rolling back staging table", {
				error: chainError,
				chainsProcessed,
				totalChains: chains.length,
				runId: context.runId,
			});
			await dropTableIfExists(clickhouse, STAGING_TABLE);
			throw chainError;
		}

		// Step 4: Verify staging table has data before swapping
		const stagingCount = await clickhouse.query<{ count: string }>(
			`SELECT count() AS count FROM ${STAGING_TABLE}`,
		);
		const stagingRowCount = Number(stagingCount[0]?.count ?? 0);

		if (stagingRowCount === 0) {
			log.error("Staging table is empty after rebuild, aborting swap", {
				runId: context.runId,
			});
			await dropTableIfExists(clickhouse, STAGING_TABLE);
			throw new Error("Staging table empty after full rebuild");
		}

		// Step 5: Atomically swap staging → live
		await clickhouse.command(
			`EXCHANGE TABLES ${STAGING_TABLE} AND prices_current`,
		);
		// Drop the old data (now in the staging table name)
		await dropTableIfExists(clickhouse, STAGING_TABLE);

		// Step 6: Refresh chain metadata (small table, safe to truncate+rebuild)
		await clickhouse.command("TRUNCATE TABLE prices_chain_metadata");
		await clickhouse.command(
			`INSERT INTO prices_chain_metadata (chain_slug, latest_date, updated_at)
			SELECT chain_slug, max(target_date), now()
			FROM prices WHERE target_date <= today()
			GROUP BY chain_slug`,
			undefined,
			{ max_execution_time: 120 },
		);

		log.info("prices_current refresh completed", {
			runId: context.runId,
			rowCount: stagingRowCount,
			chainCount: chains.length,
			totalDurationMs: Date.now() - startTime,
		});

		return [];
	},
};
