/**
 * Unit Backfill Script
 *
 * Parses and normalizes unit/quantity for all retailer_items.
 * Respects manual overrides (unitOverrideBy = 'manual').
 *
 * Usage: DATABASE_URL=... npx tsx scripts/backfill-units.ts
 */

import { sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { retailerItems } from "@/db/schema";
import { parseUnit } from "@/lib/matching/normalize";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

const BATCH_SIZE = 5000;

async function main() {
	const db = getDatabase();

	console.log("\n=== Unit Backfill ===\n");

	let totalProcessed = 0;
	let totalParsed = 0;
	let batchNum = 0;

	while (true) {
		batchNum++;

		// Fetch items that need unit normalization
		const items = await db
			.select({
				id: retailerItems.id,
				name: retailerItems.name,
				unit: retailerItems.unit,
				unitQuantity: retailerItems.unitQuantity,
			})
			.from(retailerItems)
			.where(
				sql`${retailerItems.mergedIntoId} IS NULL
					AND ${retailerItems.normalizedUnit} IS NULL
					AND (${retailerItems.unitOverrideBy} IS NULL)`,
			)
			.limit(BATCH_SIZE);

		if (items.length === 0) break;

		const updates: Array<{
			id: string;
			normalizedUnit: string;
			normalizedQuantity: number;
		}> = [];

		for (const item of items) {
			const parsed = parseUnit(
				item.unit ?? null,
				item.unitQuantity ?? null,
				item.name,
			);
			if (parsed) {
				updates.push({
					id: item.id,
					normalizedUnit: parsed.unit,
					normalizedQuantity: parsed.quantity,
				});
			}
		}

		if (updates.length > 0) {
			const values = sql.join(
				updates.map(
					(u) => sql`(${u.id}, ${u.normalizedUnit}, ${u.normalizedQuantity}::real)`,
				),
				sql`, `,
			);

			await db.execute(sql`
				UPDATE retailer_items AS ri
				SET
					normalized_unit = src.normalized_unit,
					normalized_quantity = src.normalized_quantity,
					unit_override_by = 'auto'
				FROM (VALUES ${values}) AS src(id, normalized_unit, normalized_quantity)
				WHERE ri.id = src.id
			`);
		}

		// For items that couldn't be parsed, mark them with 'auto-none' to avoid
		// re-scanning them, while distinguishing from successfully parsed ('auto').
		// This allows re-processing if the parser is improved later by targeting 'auto-none'.
		const unparsedIds = items
			.filter((item) => !updates.find((u) => u.id === item.id))
			.map((item) => item.id);

		if (unparsedIds.length > 0) {
			const unparsedValues = sql.join(
				unparsedIds.map((id) => sql`(${id})`),
				sql`, `,
			);
			await db.execute(sql`
				UPDATE retailer_items AS ri
				SET unit_override_by = 'auto-none'
				FROM (VALUES ${unparsedValues}) AS src(id)
				WHERE ri.id = src.id AND ri.normalized_unit IS NULL
			`);
		}

		totalProcessed += items.length;
		totalParsed += updates.length;

		if (batchNum % 10 === 0 || items.length < BATCH_SIZE) {
			log.info("Unit backfill progress", {
				batch: batchNum,
				totalProcessed,
				totalParsed,
				parsePct: ((totalParsed / totalProcessed) * 100).toFixed(1),
			});
		}
	}

	console.log(`Total processed: ${totalProcessed}`);
	console.log(`Total parsed: ${totalParsed}`);
	console.log(
		`Parse rate: ${totalProcessed > 0 ? ((totalParsed / totalProcessed) * 100).toFixed(1) : 0}%`,
	);

	// Verification: coverage per chain
	const verifyResult = await db.execute(sql`
		SELECT
			chain_slug,
			COUNT(*) as total,
			SUM(CASE WHEN normalized_unit IS NOT NULL THEN 1 ELSE 0 END) as has_unit,
			ROUND(SUM(CASE WHEN normalized_unit IS NOT NULL THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 1) as pct
		FROM retailer_items
		WHERE merged_into_id IS NULL
		GROUP BY chain_slug
		ORDER BY total DESC
	`);

	const verifyRows = (verifyResult as { rows?: Array<Record<string, unknown>> }).rows ?? [];
	console.log("\n=== Unit Coverage by Chain ===");
	console.log("Chain             | Total     | Has Unit  | %");
	console.log("------------------|-----------|-----------|------");
	for (const row of verifyRows) {
		const chain = String(row.chain_slug ?? "").padEnd(17);
		const total = String(row.total ?? 0).padStart(9);
		const hasUnit = String(row.has_unit ?? 0).padStart(9);
		const pct = String(row.pct ?? 0).padStart(5);
		console.log(`${chain} | ${total} | ${hasUnit} | ${pct}%`);
	}
}

main().catch((error) => {
	log.error("Unit backfill failed", { error });
	console.error(error);
	process.exit(1);
});
