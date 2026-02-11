/**
 * Refresh prices_current + prices_chain_metadata ClickHouse Tables
 *
 * Aggregates the raw `prices` table into a single-row-per-combo
 * current prices table for fast reads. Runs after daily ingestion.
 */

import { getClickHouse } from "@/lib/clickhouse";
import { createLogger } from "@/utils/logger";
import type { CronExecutionContext, CronJobHandler } from "../types";

const log = createLogger("app");

export const refreshPricesCurrentHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		log.info("Starting prices_current refresh", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			isManual: context.isManual,
		});

		const clickhouse = getClickHouse();
		const startTime = Date.now();

		// Refresh prices_current: TRUNCATE + INSERT from 30-day window
		await clickhouse.query("TRUNCATE TABLE prices_current");

		await clickhouse.query(
			`INSERT INTO prices_current
			SELECT
				retailer_item_id,
				chain_slug,
				store_id,
				argMax(name, target_date) AS name,
				argMax(brand, target_date) AS brand,
				argMax(category, target_date) AS category,
				argMax(external_id, target_date) AS external_id,
				argMax(barcode, target_date) AS barcode,
				argMax(price_cents, target_date) AS price_cents,
				argMax(price_status, target_date) AS price_status,
				argMax(price_unavailable_reason, target_date) AS price_unavailable_reason,
				argMax(discount_price_cents, target_date) AS discount_price_cents,
				argMax(unit_price_cents, target_date) AS unit_price_cents,
				max(target_date) AS target_date,
				now() AS imported_at
			FROM prices
			WHERE target_date >= today() - 30
				AND target_date <= today()
			GROUP BY retailer_item_id, chain_slug, store_id`,
			undefined,
			{ max_execution_time: 300 },
		);

		const refreshDuration = Date.now() - startTime;

		// Refresh chain metadata
		await clickhouse.query("TRUNCATE TABLE prices_chain_metadata");
		await clickhouse.query(
			`INSERT INTO prices_chain_metadata
			SELECT chain_slug, max(target_date) AS latest_date, now() AS updated_at
			FROM prices
			WHERE target_date <= today()
			GROUP BY chain_slug`,
			undefined,
			{ max_execution_time: 120 },
		);

		const metadataDuration = Date.now() - startTime - refreshDuration;

		// Verify row count
		const countRows = await clickhouse.query<{ count: string }>(
			"SELECT count() AS count FROM prices_current",
		);
		const rowCount = Number(countRows[0]?.count ?? 0);

		log.info("prices_current refresh completed", {
			runId: context.runId,
			rowCount,
			refreshDurationMs: refreshDuration,
			metadataDurationMs: metadataDuration,
			totalDurationMs: Date.now() - startTime,
		});

		return [];
	},
};
