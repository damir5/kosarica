#!/usr/bin/env tsx
/**
 * Backfill search_index table with existing data
 * Usage: pnpm tsx scripts/backfill-search-index.ts [--products] [--items] [--stores]
 * No args = backfill all
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { chains, products, retailerItems, searchIndex, stores } from "@/db/schema";
import { generatePrefixedId } from "@/utils/id";

const BATCH_SIZE = 1000;

async function backfillProducts(): Promise<number> {
	const db = getDatabase();
	let total = 0;
	let offset = 0;

	console.log("Backfilling products...");

	while (true) {
		const batch = await db.select().from(products).limit(BATCH_SIZE).offset(offset);

		if (batch.length === 0) break;

		const values = batch.map((product) => ({
			id: generatePrefixedId("six"),
			entityType: "product" as const,
			entityId: product.id,
			chainSlug: null,
			category: product.category ?? null,
			subcategory: product.subcategory ?? null,
			title: product.name,
			subtitle: product.brand ?? null,
			body:
				[product.description, product.category, product.subcategory]
					.filter(Boolean)
					.join(" ") || null,
			imageUrl: product.imageUrl ?? null,
		}));

		await db.insert(searchIndex).values(values).onConflictDoNothing();

		total += batch.length;
		offset += BATCH_SIZE;
		console.log(`  Products: ${total} indexed`);
	}

	return total;
}

async function backfillItems(): Promise<number> {
	const db = getDatabase();
	let total = 0;
	let offset = 0;

	console.log("Backfilling retailer items...");

	while (true) {
		const batch = await db
			.select()
			.from(retailerItems)
			.limit(BATCH_SIZE)
			.offset(offset);

		if (batch.length === 0) break;

		const values = batch.map((item) => ({
			id: generatePrefixedId("six"),
			entityType: "item" as const,
			entityId: item.id,
			chainSlug: item.chainSlug ?? null,
			category: item.category ?? null,
			subcategory: item.subcategory ?? null,
			title: item.name,
			subtitle: item.brand ?? null,
			body:
				[item.description, item.category, item.subcategory, item.brand]
					.filter(Boolean)
					.join(" ") || null,
			imageUrl: item.imageUrl ?? null,
		}));

		await db.insert(searchIndex).values(values).onConflictDoNothing();

		total += batch.length;
		offset += BATCH_SIZE;

		if (total % 10000 === 0) {
			console.log(`  Items: ${total} indexed`);
		}
	}

	console.log(`  Items: ${total} indexed (complete)`);
	return total;
}

async function backfillStores(): Promise<number> {
	const db = getDatabase();

	console.log("Backfilling stores...");

	const storeRows = await db
		.select({
			store: stores,
			chainName: chains.name,
		})
		.from(stores)
		.innerJoin(chains, eq(chains.slug, stores.chainSlug));

	if (storeRows.length === 0) {
		console.log("  Stores: 0 indexed");
		return 0;
	}

	const values = storeRows.map((row) => ({
		id: generatePrefixedId("six"),
		entityType: "store" as const,
		entityId: row.store.id,
		chainSlug: row.store.chainSlug ?? null,
		category: null,
		subcategory: null,
		title: row.store.name,
		subtitle: row.chainName,
		body:
			[row.store.address, row.store.city, row.store.postalCode, row.chainName]
				.filter(Boolean)
				.join(" ") || null,
		imageUrl: null,
	}));

	for (let index = 0; index < values.length; index += BATCH_SIZE) {
		const batch = values.slice(index, index + BATCH_SIZE);
		await db.insert(searchIndex).values(batch).onConflictDoNothing();
	}

	console.log(`  Stores: ${values.length} indexed`);
	return values.length;
}

async function main() {
	const args = process.argv.slice(2);
	const all = args.length === 0;
	const doProducts = all || args.includes("--products");
	const doItems = all || args.includes("--items");
	const doStores = all || args.includes("--stores");

	console.log("Search Index Backfill");
	console.log("=====================");

	const start = Date.now();
	let totalIndexed = 0;

	if (doProducts) {
		totalIndexed += await backfillProducts();
	}
	if (doItems) {
		totalIndexed += await backfillItems();
	}
	if (doStores) {
		totalIndexed += await backfillStores();
	}

	const durationSec = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`\nComplete: ${totalIndexed} entities indexed in ${durationSec}s`);
	process.exit(0);
}

main().catch((error) => {
	console.error("Backfill failed:", error);
	process.exit(1);
});
