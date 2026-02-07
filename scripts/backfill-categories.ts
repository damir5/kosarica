/**
 * Category Backfill Script
 *
 * Normalizes existing retailer_items categories using the mapping rules.
 * Respects manual overrides (categoryOverrideBy = 'manual').
 *
 * Usage: DATABASE_URL=... npx tsx scripts/backfill-categories.ts
 */

import { sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { normalizeCategory } from "@/lib/matching/categories";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

async function main() {
	const db = getDatabase();

	// Step 1: Get distinct raw categories per chain
	const rawCategoriesResult = await db.execute(sql`
		SELECT DISTINCT chain_slug, category
		FROM retailer_items
		WHERE category IS NOT NULL
			AND merged_into_id IS NULL
			AND (category_override_by IS NULL OR category_override_by != 'manual')
		ORDER BY chain_slug, category
	`);

	const rawRows = (Array.isArray(rawCategoriesResult) ? rawCategoriesResult : (rawCategoriesResult as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<Record<string, unknown>>;

	console.log(`\n=== Category Backfill ===`);
	console.log(`Found ${rawRows.length} distinct (chain, category) pairs to process.\n`);

	let totalUpdated = 0;
	let mappedPairs = 0;
	let unmappedPairs = 0;
	const unmapped: string[] = [];

	for (const row of rawRows) {
		const chainSlug = row.chain_slug as string;
		const rawCategory = row.category as string;

		const normalized = normalizeCategory(rawCategory);
		if (!normalized) {
			unmappedPairs++;
			unmapped.push(`${chainSlug}: "${rawCategory}"`);
			continue;
		}

		mappedPairs++;

		// Batch update: set category and optionally subcategory
		const result = await db.execute(sql`
			UPDATE retailer_items
			SET
				category = ${normalized.category},
				subcategory = COALESCE(subcategory, ${normalized.subcategory}),
				category_override_by = 'auto'
			WHERE chain_slug = ${chainSlug}
				AND category = ${rawCategory}
				AND merged_into_id IS NULL
				AND (category_override_by IS NULL OR category_override_by != 'manual')
		`);

		const rowCount = (result as { rowCount?: number }).rowCount ?? 0;
		totalUpdated += rowCount;
	}

	console.log(`Mapped pairs: ${mappedPairs}`);
	console.log(`Unmapped pairs: ${unmappedPairs}`);
	console.log(`Retailer items updated: ${totalUpdated}`);

	if (unmapped.length > 0) {
		console.log(`\nUnmapped categories (${unmapped.length}):`);
		for (const item of unmapped.slice(0, 30)) {
			console.log(`  ${item}`);
		}
		if (unmapped.length > 30) {
			console.log(`  ... and ${unmapped.length - 30} more`);
		}
	}

	// Verification
	const verifyResult = await db.execute(sql`
		SELECT category, COUNT(*) as cnt
		FROM retailer_items
		WHERE merged_into_id IS NULL
		GROUP BY category
		ORDER BY cnt DESC
	`);
	const verifyRows = (Array.isArray(verifyResult) ? verifyResult : (verifyResult as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<Record<string, unknown>>;
	console.log(`\n=== Category Distribution ===`);
	for (const row of verifyRows) {
		console.log(`  ${String(row.category ?? "(null)").padEnd(30)} ${row.cnt}`);
	}
}

main().catch((error) => {
	log.error("Category backfill failed", { error });
	console.error(error);
	process.exit(1);
});
