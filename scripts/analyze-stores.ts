import { getDatabase } from "../src/db";
import * as schema from "../src/db/schema";

type Chain = typeof schema.chains.$inferSelect;

interface ChainReport {
	slug: string;
	name: string;
	totalStores: number;
	activeStores: number;
	pendingStores: number;
	enrichedStores: number;
	needsReviewStores: number;
	virtualStores: number;
	physicalStores: number;
	cities: string[];
	storeIds: string[];
}

interface DetailedStore {
	id: string;
	chainSlug: string;
	chainName: string;
	name: string;
	address: string | null;
	city: string | null;
	postalCode: string | null;
	latitude: string | null;
	longitude: string | null;
	isVirtual: boolean | null;
	status: string | null;
	identifierTypes: string[];
	identifierValues: string[];
	createdAt: Date | null;
	updatedAt: Date | null;
}

interface StoreAnalysisReport {
	generatedAt: Date;
	totalStores: number;
	totalChains: number;
	storesByStatus: Record<string, number>;
	storesByCity: Record<string, number>;
	chains: ChainReport[];
	detailedStores: DetailedStore[];
	issues: string[];
}

async function analyzeStores(): Promise<void> {
	console.log("🔍 Analyzing imported stores in development database...\n");

	const db = getDatabase();

	// Get all chains
	const allChains = await db.select().from(schema.chains).orderBy(schema.chains.slug);
	console.log(`📊 Found ${allChains.length} chains in database\n`);

	// Get all stores with chain info
	const allStores = await db
		.select({
			id: schema.stores.id,
			chainSlug: schema.stores.chainSlug,
			name: schema.stores.name,
			address: schema.stores.address,
			city: schema.stores.city,
			postalCode: schema.stores.postalCode,
			latitude: schema.stores.latitude,
			longitude: schema.stores.longitude,
			isVirtual: schema.stores.isVirtual,
			status: schema.stores.status,
			priceSourceStoreId: schema.stores.priceSourceStoreId,
			createdAt: schema.stores.createdAt,
			updatedAt: schema.stores.updatedAt,
		})
		.from(schema.stores)
		.orderBy(schema.stores.chainSlug, schema.stores.name);

	console.log(`🏪 Found ${allStores.length} total stores in database\n`);

	// Get all store identifiers
	const allIdentifiers = await db
		.select({
			storeId: schema.storeIdentifiers.storeId,
			type: schema.storeIdentifiers.type,
			value: schema.storeIdentifiers.value,
		})
		.from(schema.storeIdentifiers);

	// Build a map of store -> identifiers
	const storeIdentifiersMap = new Map<string, Array<{ type: string; value: string }>>();
	for (const identifier of allIdentifiers) {
		if (!storeIdentifiersMap.has(identifier.storeId)) {
			storeIdentifiersMap.set(identifier.storeId, []);
		}
		storeIdentifiersMap.get(identifier.storeId)!.push({
			type: identifier.type,
			value: identifier.value,
		});
	}

	// Create chain lookup
	const chainMap = new Map<string, Chain>();
	for (const chain of allChains) {
		chainMap.set(chain.slug, chain);
	}

	// Analyze by chain
	const chainReports: ChainReport[] = [];
	const issues: string[] = [];
	const storesByStatus: Record<string, number> = {};
	const storesByCity: Record<string, number> = {};
	const detailedStores: DetailedStore[] = [];

	for (const chain of allChains) {
		const chainStores = allStores.filter((s) => s.chainSlug === chain.slug);

		const activeStores = chainStores.filter((s) => s.status === "active").length;
		const pendingStores = chainStores.filter((s) => s.status === "pending").length;
		const enrichedStores = chainStores.filter((s) => s.status === "enriched").length;
		const needsReviewStores = chainStores.filter((s) => s.status === "needs_review").length;
		const virtualStores = chainStores.filter((s) => s.isVirtual).length;
		const physicalStores = chainStores.filter((s) => !s.isVirtual).length;

		const cities = [...new Set(chainStores.map((s) => s.city).filter(Boolean) as string[])].sort();

		const report: ChainReport = {
			slug: chain.slug,
			name: chain.name,
			totalStores: chainStores.length,
			activeStores,
			pendingStores,
			enrichedStores,
			needsReviewStores,
			virtualStores,
			physicalStores,
			cities,
			storeIds: chainStores.map((s) => s.id),
		};

		chainReports.push(report);

		// Track potential issues
		if (chainStores.length > 0 && cities.length === 0) {
			issues.push(`Chain ${chain.name} (${chain.slug}) has ${chainStores.length} stores but no city information`);
		}
	}

	// Count by status
	for (const store of allStores) {
		const statusKey = store.status ?? "unknown";
		storesByStatus[statusKey] = (storesByStatus[statusKey] || 0) + 1;
		if (store.city) {
			storesByCity[store.city] = (storesByCity[store.city] || 0) + 1;
		}
	}

	// Build detailed store list
	for (const store of allStores) {
		const chain = chainMap.get(store.chainSlug);
		const identifiers = storeIdentifiersMap.get(store.id) || [];

		detailedStores.push({
			id: store.id,
			chainSlug: store.chainSlug,
			chainName: chain?.name || "Unknown",
			name: store.name,
			address: store.address,
			city: store.city,
			postalCode: store.postalCode,
			latitude: store.latitude,
			longitude: store.longitude,
			isVirtual: store.isVirtual,
			status: store.status,
			identifierTypes: [...new Set(identifiers.map((i) => i.type))],
			identifierValues: identifiers.map((i) => `${i.type}:${i.value}`),
			createdAt: store.createdAt,
			updatedAt: store.updatedAt,
		});
	}

	// Create full report
	const report: StoreAnalysisReport = {
		generatedAt: new Date(),
		totalStores: allStores.length,
		totalChains: allChains.length,
		storesByStatus,
		storesByCity: Object.fromEntries(
			Object.entries(storesByCity).sort(([, a], [, b]) => b - a).slice(0, 20),
		),
		chains: chainReports,
		detailedStores,
		issues,
	};

	// Print summary
	console.log("═══════════════════════════════════════════════════════════════");
	console.log("                    STORE ANALYSIS REPORT");
	console.log("═══════════════════════════════════════════════════════════════\n");

	console.log(`Generated: ${report.generatedAt.toISOString()}`);
	console.log(`Total Chains: ${report.totalChains}`);
	console.log(`Total Stores: ${report.totalStores}\n`);

	console.log("───────────────────────────────────────────────────────────────");
	console.log("                      STORES BY STATUS");
	console.log("───────────────────────────────────────────────────────────────\n");
	for (const [status, count] of Object.entries(report.storesByStatus).sort(
		([, a], [, b]) => b - a,
	)) {
		console.log(`  ${status.padEnd(20)} ${count.toString().padStart(6)}`);
	}

	console.log("\n───────────────────────────────────────────────────────────────");
	console.log("                      TOP 20 CITIES");
	console.log("───────────────────────────────────────────────────────────────\n");
	for (const [city, count] of Object.entries(report.storesByCity)) {
		console.log(`  ${city.padEnd(30)} ${count.toString().padStart(6)}`);
	}

	console.log("\n───────────────────────────────────────────────────────────────");
	console.log("                      CHAINS BREAKDOWN");
	console.log("───────────────────────────────────────────────────────────────\n");
	for (const chain of report.chains) {
		console.log(`🏷️  ${chain.name} (${chain.slug})`);
		console.log(`   Total: ${chain.totalStores} | Active: ${chain.activeStores} | Pending: ${chain.pendingStores} | Virtual: ${chain.virtualStores} | Physical: ${chain.physicalStores}`);
		if (chain.cities.length > 0) {
			console.log(`   Cities (${chain.cities.length}): ${chain.cities.slice(0, 10).join(", ")}${chain.cities.length > 10 ? "..." : ""}`);
		}
		console.log("");
	}

	if (issues.length > 0) {
		console.log("───────────────────────────────────────────────────────────────");
		console.log("                      ISSUES FOUND");
		console.log("───────────────────────────────────────────────────────────────\n");
		for (const issue of issues) {
			console.log(`  ⚠️  ${issue}`);
		}
		console.log("");
	}

	console.log("═══════════════════════════════════════════════════════════════\n");

	// Write full report to file
	const reportPath = "./data/stores-analysis-report.json";
	await import("node:fs/promises").then((fs) =>
		fs.mkdir("./data", { recursive: true }).then(() =>
			fs.writeFile(reportPath, JSON.stringify(report, null, 2)),
		),
	);
	console.log(`📄 Full detailed report saved to: ${reportPath}\n`);
}

// Run analysis
analyzeStores()
	.then(() => {
		console.log("✅ Store analysis completed successfully");
		process.exit(0);
	})
	.catch((error) => {
		console.error("❌ Error analyzing stores:", error);
		process.exit(1);
	});
