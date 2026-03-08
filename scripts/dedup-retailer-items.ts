/**
 * Dedup Retailer Items Script
 *
 * Step 1: Backfill normalized_name_hash for ALL retailer_items
 * Step 2: Soft-delete duplicates for chains without externalId (eurospin, interspar)
 * Step 3: Report final counts per chain
 *
 * Usage: DATABASE_URL=... npx tsx scripts/dedup-retailer-items.ts
 */

import { eq, isNull, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import {
	retailerItemBarcodes,
	retailerItemFeatures,
	retailerItems,
	semanticPairDecisions,
	skuItemLinks,
} from "@/db/schema";
import { computeNameHash } from "@/lib/matching/normalize";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

const BATCH_SIZE = 5000;

interface DupGroup {
	chainSlug: string;
	normalizedNameHash: string;
	ids: string[];
}

async function backfillNameHashes(): Promise<number> {
	const db = getDatabase();
	let totalUpdated = 0;
	let batchNum = 0;

	while (true) {
		batchNum++;
		const items = await db
			.select({ id: retailerItems.id, name: retailerItems.name })
			.from(retailerItems)
			.where(isNull(retailerItems.normalizedNameHash))
			.limit(BATCH_SIZE);

		if (items.length === 0) break;

		// Build batch update values
		const updates = items.map((item) => ({
			id: item.id,
			hash: computeNameHash(item.name),
		}));

		// Batch update using raw SQL for efficiency
		const values = sql.join(
			updates.map((u) => sql`(${u.id}, ${u.hash})`),
			sql`, `,
		);

		await db.execute(sql`
			UPDATE retailer_items AS ri
			SET normalized_name_hash = src.hash
			FROM (VALUES ${values}) AS src(id, hash)
			WHERE ri.id = src.id
		`);

		totalUpdated += items.length;
		if (batchNum % 10 === 0 || items.length < BATCH_SIZE) {
			log.info("Backfill progress", { totalUpdated, batch: batchNum });
		}
	}

	return totalUpdated;
}

async function findDuplicateGroups(
	chainsWithoutExternalId: string[],
): Promise<DupGroup[]> {
	const db = getDatabase();
	const groups: DupGroup[] = [];

	for (const chainSlug of chainsWithoutExternalId) {
		const result = await db.execute(sql`
			SELECT
				chain_slug,
				normalized_name_hash,
				array_agg(id ORDER BY created_at ASC, id ASC) as ids
			FROM retailer_items
			WHERE chain_slug = ${chainSlug}
				AND merged_into_id IS NULL
				AND normalized_name_hash IS NOT NULL
			GROUP BY chain_slug, normalized_name_hash
			HAVING COUNT(*) > 1
		`);

		const rows = (Array.isArray(result) ? result : (result as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<Record<string, unknown>>;
		for (const row of rows) {
			groups.push({
				chainSlug: row.chain_slug as string,
				normalizedNameHash: row.normalized_name_hash as string,
				ids: row.ids as string[],
			});
		}

		log.info("Found duplicate groups", {
			chainSlug,
			groupCount: rows.length,
		});
	}

	return groups;
}

interface SurvivorScore {
	id: string;
	barcodeCount: number;
	fieldCount: number;
}

async function pickSurvivor(itemIds: string[]): Promise<string> {
	const db = getDatabase();

	// Count barcodes per item
	const barcodeCounts = await db
		.select({
			retailerItemId: retailerItemBarcodes.retailerItemId,
			count: sql<number>`count(*)::int`,
		})
		.from(retailerItemBarcodes)
		.where(
			sql`${retailerItemBarcodes.retailerItemId} IN (${sql.join(
				itemIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		)
		.groupBy(retailerItemBarcodes.retailerItemId);

	const bcMap = new Map(
		barcodeCounts.map((r) => [r.retailerItemId, r.count]),
	);

	// Count non-null fields per item
	const items = await db
		.select({
			id: retailerItems.id,
			description: retailerItems.description,
			brand: retailerItems.brand,
			category: retailerItems.category,
			subcategory: retailerItems.subcategory,
			unit: retailerItems.unit,
			unitQuantity: retailerItems.unitQuantity,
			imageUrl: retailerItems.imageUrl,
		})
		.from(retailerItems)
		.where(
			sql`${retailerItems.id} IN (${sql.join(
				itemIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);

	const scores: SurvivorScore[] = items.map((item) => {
		let fieldCount = 0;
		if (item.description) fieldCount++;
		if (item.brand) fieldCount++;
		if (item.category) fieldCount++;
		if (item.subcategory) fieldCount++;
		if (item.unit) fieldCount++;
		if (item.unitQuantity) fieldCount++;
		if (item.imageUrl) fieldCount++;
		return {
			id: item.id,
			barcodeCount: bcMap.get(item.id) ?? 0,
			fieldCount,
		};
	});

	// Sort: most barcodes first, then most non-null fields
	scores.sort((a, b) => {
		if (b.barcodeCount !== a.barcodeCount) return b.barcodeCount - a.barcodeCount;
		return b.fieldCount - a.fieldCount;
	});

	return scores[0]?.id ?? itemIds[0];
}

async function mergeDuplicates(groups: DupGroup[]): Promise<{
	groupsProcessed: number;
	itemsMerged: number;
	barcodesMigrated: number;
}> {
	const db = getDatabase();
	let groupsProcessed = 0;
	let itemsMerged = 0;
	let barcodesMigrated = 0;

	for (const group of groups) {
		const survivorId = await pickSurvivor(group.ids);
		const duplicateIds = group.ids.filter((id) => id !== survivorId);

		if (duplicateIds.length === 0) continue;

		// Migrate barcodes from duplicates to survivor
		for (const dupId of duplicateIds) {
			const result = await db.execute(sql`
				UPDATE retailer_item_barcodes
				SET retailer_item_id = ${survivorId}
				WHERE retailer_item_id = ${dupId}
				AND NOT EXISTS (
					SELECT 1 FROM retailer_item_barcodes existing
					WHERE existing.retailer_item_id = ${survivorId}
					AND existing.barcode = retailer_item_barcodes.barcode
				)
			`);
			const rowCount = (result as { rowCount?: number }).rowCount ?? 0;
			barcodesMigrated += rowCount;
		}

		// Delete orphaned barcodes that conflicted
		for (const dupId of duplicateIds) {
			await db
				.delete(retailerItemBarcodes)
				.where(eq(retailerItemBarcodes.retailerItemId, dupId));
		}

		const dupIdList = sql.join(duplicateIds.map((id) => sql`${id}`), sql`, `);

		// Migrate feature row to survivor if survivor doesn't already have one.
		await db.execute(sql`
			UPDATE retailer_item_features
			SET retailer_item_id = ${survivorId}
			WHERE retailer_item_id IN (${dupIdList})
			AND NOT EXISTS (
				SELECT 1 FROM retailer_item_features existing
				WHERE existing.retailer_item_id = ${survivorId}
			)
		`);

		// Drop remaining feature rows for merged duplicates.
		await db.execute(sql`
			DELETE FROM retailer_item_features WHERE retailer_item_id IN (${dupIdList})
		`);

		// Move canonical SKU link when possible, then clear stale duplicate links.
		await db.execute(sql`
			UPDATE sku_item_links
			SET retailer_item_id = ${survivorId}
			WHERE retailer_item_id IN (${dupIdList})
			AND NOT EXISTS (
				SELECT 1 FROM sku_item_links existing
				WHERE existing.retailer_item_id = ${survivorId}
			)
		`);
		await db.execute(sql`
			DELETE FROM sku_item_links WHERE retailer_item_id IN (${dupIdList})
		`);

		// Any pair decisions involving merged-away items are invalid and should be rebuilt.
		await db
			.delete(semanticPairDecisions)
			.where(
				sql`${semanticPairDecisions.itemAId} IN (${dupIdList}) OR ${semanticPairDecisions.itemBId} IN (${dupIdList})`,
			);
		await db
			.update(retailerItemFeatures)
			.set({ updatedAt: new Date() })
			.where(eq(retailerItemFeatures.retailerItemId, survivorId));
		await db
			.update(skuItemLinks)
			.set({ createdAt: new Date() })
			.where(eq(skuItemLinks.retailerItemId, survivorId));
		await db.execute(sql`
			UPDATE semantic_pair_decisions
			SET updated_at = NOW()
			WHERE item_a_id = ${survivorId} OR item_b_id = ${survivorId}
		`);

		// Soft-delete duplicates by setting merged_into_id
		await db.execute(sql`
			UPDATE retailer_items
			SET merged_into_id = ${survivorId}
			WHERE id IN (${sql.join(
				duplicateIds.map((id) => sql`${id}`),
				sql`, `,
			)})
		`);

		itemsMerged += duplicateIds.length;
		groupsProcessed++;

		if (groupsProcessed % 1000 === 0) {
			log.info("Merge progress", {
				chain: group.chainSlug,
				groupsProcessed,
				itemsMerged,
				barcodesMigrated,
			});
		}
	}

	return { groupsProcessed, itemsMerged, barcodesMigrated };
}

async function reportCounts(): Promise<void> {
	const db = getDatabase();
	const result = await db.execute(sql`
		SELECT
			chain_slug,
			COUNT(*) FILTER (WHERE merged_into_id IS NULL) as active,
			COUNT(*) FILTER (WHERE merged_into_id IS NOT NULL) as merged,
			COUNT(*) as total
		FROM retailer_items
		GROUP BY chain_slug
		ORDER BY active DESC
	`);

	const rows = (Array.isArray(result) ? result : (result as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<Record<string, unknown>>;
	console.log("\n=== Retailer Items Report ===");
	console.log("Chain             | Active    | Merged    | Total");
	console.log("------------------|-----------|-----------|----------");
	for (const row of rows) {
		const chain = String(row.chain_slug ?? "").padEnd(17);
		const active = String(row.active ?? 0).padStart(9);
		const merged = String(row.merged ?? 0).padStart(9);
		const total = String(row.total ?? 0).padStart(9);
		console.log(`${chain} | ${active} | ${merged} | ${total}`);
	}
	console.log("================================\n");
}

async function main() {
	console.log("=== Retailer Item Deduplication ===\n");

	// Step 1: Backfill name hashes
	console.log("Step 1: Backfilling normalized_name_hash...");
	const hashesUpdated = await backfillNameHashes();
	console.log(`  Updated ${hashesUpdated} items with name hashes.\n`);

	// Step 2: Find and merge duplicates
	const chainsWithoutExternalId = ["eurospin", "interspar"];
	console.log(
		`Step 2: Finding duplicates in chains: ${chainsWithoutExternalId.join(", ")}...`,
	);
	const groups = await findDuplicateGroups(chainsWithoutExternalId);
	const totalDups = groups.reduce((sum, g) => sum + g.ids.length - 1, 0);
	console.log(
		`  Found ${groups.length} groups with ${totalDups} duplicate items.\n`,
	);

	if (groups.length > 0) {
		console.log("Step 2b: Merging duplicates (soft-delete)...");
		const mergeResult = await mergeDuplicates(groups);
		console.log(`  Groups processed: ${mergeResult.groupsProcessed}`);
		console.log(`  Items merged: ${mergeResult.itemsMerged}`);
		console.log(`  Barcodes migrated: ${mergeResult.barcodesMigrated}\n`);
	}

	// Step 3: Report
	console.log("Step 3: Final counts:");
	await reportCounts();
}

main().catch((error) => {
	log.error("Dedup script failed", { error });
	console.error(error);
	process.exit(1);
});
