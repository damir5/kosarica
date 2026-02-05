import { eq } from "drizzle-orm";
import { getDatabase } from "../src/db";
import * as schema from "../src/db/schema";

async function analyzeStoreDetails(): Promise<void> {
	console.log("🔍 Analyzing store identifiers and metadata...\n");

	const db = getDatabase();

	// Get store identifiers summary
	const identifierStats = await db
		.select({
			type: schema.storeIdentifiers.type,
			count: schema.storeIdentifiers.type, // placeholder for count
		})
		.from(schema.storeIdentifiers);

	// Count by identifier type
	const typeCounts = new Map<string, number>();
	for (const id of identifierStats) {
		typeCounts.set(id.type, (typeCounts.get(id.type) || 0) + 1);
	}

	// Sample stores per chain
	const chains = await db.select().from(schema.chains);
	const samples: Record<string, any[]> = {};

	for (const chain of chains) {
		const chainStores = await db
			.select({
				id: schema.stores.id,
				name: schema.stores.name,
				city: schema.stores.city,
				address: schema.stores.address,
				isVirtual: schema.stores.isVirtual,
				status: schema.stores.status,
				createdAt: schema.stores.createdAt,
			})
			.from(schema.stores)
			.where(eq(schema.stores.chainSlug, chain.slug))
			.limit(3);

		// Get identifiers for sample stores
		for (const store of chainStores) {
			const identifiers = await db
				.select({
					type: schema.storeIdentifiers.type,
					value: schema.storeIdentifiers.value,
				})
				.from(schema.storeIdentifiers)
				.where(eq(schema.storeIdentifiers.storeId, store.id));

			(store as any).identifiers = identifiers;
		}

		samples[chain.slug] = chainStores;
	}

	console.log("═══════════════════════════════════════════════════════════════");
	console.log("              STORE IDENTIFIER TYPE DISTRIBUTION");
	console.log("═══════════════════════════════════════════════════════════════\n");

	for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${type.padEnd(25)} ${count.toString().padStart(8)}`);
	}

	console.log("\n═══════════════════════════════════════════════════════════════");
	console.log("              STORE SAMPLES BY CHAIN");
	console.log("═══════════════════════════════════════════════════════════════\n");

	for (const [chainSlug, stores] of Object.entries(samples)) {
		const chain = chains.find((c) => c.slug === chainSlug);
		console.log(`🏷️  ${chain?.name || chainSlug} (${chainSlug})`);
		console.log(`   Sample stores (first 3):\n`);

		for (const store of stores as any[]) {
			console.log(`      🏪 ${store.name}`);
			if (store.city) console.log(`         City: ${store.city}`);
			if (store.address) console.log(`         Address: ${store.address}`);
			console.log(`         Virtual: ${store.isVirtual} | Status: ${store.status}`);
			if (store.identifiers && store.identifiers.length > 0) {
				console.log(`         Identifiers:`);
				for (const id of store.identifiers) {
					console.log(`           - ${id.type}: ${id.value}`);
				}
			} else {
				console.log(`         Identifiers: (none)`);
			}
			console.log(`         Created: ${store.createdAt}`);
			console.log("");
		}
		console.log("");
	}
}

// Run analysis
analyzeStoreDetails()
	.then(() => {
		console.log("✅ Store detail analysis completed successfully");
		process.exit(0);
	})
	.catch((error) => {
		console.error("❌ Error analyzing store details:", error);
		process.exit(1);
	});
