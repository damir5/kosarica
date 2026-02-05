#!/usr/bin/env tsx
/**
 * Run all typical queries and measure actual performance
 */

import { execSync } from "node:child_process";
import { performance } from "node:perf_hooks";

// ============================================================================
// Database Clients (via docker exec)
// ============================================================================

function chQuery(sql: string, params?: Record<string, string | number>): { data: unknown[]; duration: number; rowCount: number } {
	const start = performance.now();
	try {
		let query = sql;
		if (params) {
			for (const [key, value] of Object.entries(params)) {
				const placeholder = `{${key}}`;
				query = query.replace(new RegExp(placeholder.replace(/[{}]/g, "\\$&"), "g"), String(value));
				// Handle typed parameters like {chain:String}
				query = query.replace(new RegExp(`{${key}:[^}]+}`, "g"), String(value));
			}
		}

		const result = execSync(
			`docker exec ade-clickhouse clickhouse-client --format=JSONEachRow --query="${query.replace(/"/g, '\\"')}"`,
			{ encoding: "utf-8" }
		);

		const duration = performance.now() - start;
		const rows = result.trim().split("\n").filter(Boolean).map(line => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		}).filter(Boolean);

		return { data: rows, duration, rowCount: rows.length };
	} catch (error) {
		const duration = performance.now() - start;
		return {
			data: [],
			duration,
			rowCount: 0,
		};
	}
}

function pgQuery(sql: string): { data: unknown[]; duration: number; rowCount: number } {
	const start = performance.now();
	try {
		const result = execSync(
			`docker exec ade-postgres psql -U kosarica -d kosarica -t -A -c "${sql.replace(/"/g, '\\"')}"`,
			{ encoding: "utf-8" }
		);

		const duration = performance.now() - start;
		const lines = result.trim().split("\n").filter(Boolean);

		if (lines.length === 0) {
			return { data: [], duration, rowCount: 0 };
		}

		const rows: Record<string, string | null>[] = [];

		for (const line of lines) {
			const values = line.split("|").map(v => v.trim() || null);
			rows.push({
				column1: values[0],
				column2: values[1],
				column3: values[2],
				column4: values[3],
				column5: values[4],
			});
		}

		return { data: rows, duration, rowCount: rows.length };
	} catch (error) {
		const duration = performance.now() - start;
		return { data: [], duration, rowCount: 0 };
	}
}

// ============================================================================
// Query Helpers
// ============================================================================

interface QueryResult {
	name: string;
	sql: string;
	duration: number;
	rowCount: number;
	notes?: string;
}

const results: QueryResult[] = [];

// ============================================================================
// Get Chains
// ============================================================================

function getChains(): { slug: string; name: string }[] {
	const result = pgQuery("SELECT slug, name FROM chains ORDER BY name");
	return result.data.map((row: any) => ({
		slug: row.column1,
		name: row.column2,
	}));
}

// ============================================================================
// Benchmark Queries
// ============================================================================

// Query 1: Latest Prices by Store
function query1LatestPricesByStore(chainSlug: string) {
	// First get a store_id for this chain
	const storeResult = chQuery(
		`SELECT DISTINCT store_id FROM prices WHERE chain_slug = '${chainSlug}' LIMIT 1`
	);

	if (storeResult.rowCount === 0) {
		results.push({
			name: `Query 1: Latest Prices by Store (${chainSlug})`,
			sql: "N/A - No data",
			duration: 0,
			rowCount: 0,
			notes: "No price data found",
		});
		return;
	}

	const storeId = (storeResult.data[0] as any)?.store_id || "";

	const sql = `SELECT
    retailer_item_id,
    argMax(external_id, target_date) AS item_external_id,
    argMax(name, target_date) AS item_name,
    argMax(brand, target_date) AS brand,
    argMax(price_cents, target_date) AS current_price,
    argMax(price_status, target_date) AS price_status,
    argMax(discount_price_cents, target_date) AS discount_price,
    max(target_date) AS last_seen_at
FROM prices
WHERE chain_slug = '${chainSlug}' AND store_id = '${storeId}'
GROUP BY retailer_item_id
ORDER BY last_seen_at DESC
LIMIT 100`;

	const result = chQuery(sql);

	results.push({
		name: `Query 1: Latest Prices by Store (${chainSlug})`,
		sql,
		duration: result.duration,
		rowCount: result.rowCount,
		notes: `Store: ${storeId.substring(0, 12)}...`,
	});
}

// Query 2: Cross-Store Price Comparison
function query2CrossStoreComparison(chainSlug: string) {
	// Get sample item IDs
	const sampleResult = chQuery(
		`SELECT retailer_item_id FROM prices WHERE chain_slug = '${chainSlug}' GROUP BY retailer_item_id LIMIT 50`
	);

	if (sampleResult.rowCount === 0) {
		results.push({
			name: `Query 2: Cross-Store Comparison (${chainSlug})`,
			sql: "N/A - No data",
			duration: 0,
			rowCount: 0,
			notes: "No price data found",
		});
		return;
	}

	const itemIds = sampleResult.data.map((x: any) => x.retailer_item_id) as string[];
	const idList = itemIds.map((id) => `'${id}'`).join(",");

	const sql = `SELECT
    chain_slug,
    store_id,
    retailer_item_id,
    argMax(name, target_date) AS name,
    argMax(brand, target_date) AS brand,
    argMax(price_cents, target_date) AS price_cents,
    argMax(discount_price_cents, target_date) AS discount_price_cents,
    max(target_date) AS last_seen_at
FROM prices
WHERE chain_slug = '${chainSlug}'
    AND retailer_item_id IN (${idList})
GROUP BY chain_slug, store_id, retailer_item_id`;

	const result = chQuery(sql);

	results.push({
		name: `Query 2: Cross-Store Comparison (${chainSlug})`,
		sql,
		duration: result.duration,
		rowCount: result.rowCount,
		notes: `${itemIds.length} items queried`,
	});
}

// Query 3: Basket Optimization
function query3BasketOptimization(chainSlug: string) {
	// Get latest date and sample items
	const dateResult = chQuery(
		`SELECT max(target_date) AS max FROM prices WHERE chain_slug = '${chainSlug}'`
	);

	if (!dateResult.data[0] || !(dateResult.data[0] as any).max) {
		results.push({
			name: `Query 3: Basket Optimization (${chainSlug})`,
			sql: "N/A - No data",
			duration: 0,
			rowCount: 0,
			notes: "No price data found",
		});
		return;
	}

	const targetDate = (dateResult.data[0] as any).max;

	const sampleResult = chQuery(
		`SELECT retailer_item_id FROM prices WHERE chain_slug = '${chainSlug}' AND target_date = '${targetDate}' GROUP BY retailer_item_id LIMIT 20`
	);

	if (sampleResult.rowCount === 0) {
		results.push({
			name: `Query 3: Basket Optimization (${chainSlug})`,
			sql: "N/A - No data for target date",
			duration: 0,
			rowCount: 0,
			notes: `Target date: ${targetDate}`,
		});
		return;
	}

	const itemIds = sampleResult.data.map((x: any) => x.retailer_item_id) as string[];
	const idList = itemIds.map((id) => `'${id}'`).join(",");

	const sql = `SELECT
    store_id,
    retailer_item_id,
    argMax(price_cents, imported_at) AS price_cents,
    argMax(discount_price_cents, imported_at) AS discount_price_cents
FROM prices
WHERE chain_slug = '${chainSlug}'
    AND target_date = '${targetDate}'
    AND retailer_item_id IN (${idList})
GROUP BY store_id, retailer_item_id`;

	const result = chQuery(sql);

	// Phase 2 - Average prices
	const sql2 = `SELECT
    retailer_item_id,
    avg(
        if(
            discount_price_cents > 0 AND discount_price_cents < price_cents,
            discount_price_cents,
            price_cents
        )
    ) AS avg_price
FROM prices
WHERE chain_slug = '${chainSlug}'
    AND target_date = '${targetDate}'
    AND retailer_item_id IN (${idList})
GROUP BY retailer_item_id`;

	const result2 = chQuery(sql2);

	results.push({
		name: `Query 3: Basket Optimization (${chainSlug})`,
		sql: `${sql}\n\n-- Phase 2:\n${sql2}`,
		duration: result.duration + result2.duration,
		rowCount: result.rowCount + result2.rowCount,
		notes: `Phase 1: ${result.rowCount} rows, Phase 2: ${result2.rowCount} rows, Date: ${targetDate}`,
	});
}

// Query 4: Store Coverage Analysis
function query4StoreCoverage(chainSlug: string) {
	const dateResult = chQuery(
		`SELECT max(target_date) AS max FROM prices WHERE chain_slug = '${chainSlug}'`
	);

	if (!dateResult.data[0] || !(dateResult.data[0] as any).max) {
		results.push({
			name: `Query 4: Store Coverage (${chainSlug})`,
			sql: "N/A - No data",
			duration: 0,
			rowCount: 0,
			notes: "No price data found",
		});
		return;
	}

	const targetDate = (dateResult.data[0] as any).max;

	const sql = `SELECT
    chain_slug,
    store_id,
    count(DISTINCT retailer_item_id) AS item_count,
    countIf(price_status = 'available') AS available_count,
    countIf(price_status = 'unavailable') AS unavailable_count
FROM prices
WHERE target_date = '${targetDate}'
GROUP BY chain_slug, store_id
ORDER BY item_count DESC`;

	const result = chQuery(sql);

	results.push({
		name: `Query 4: Store Coverage (${chainSlug})`,
		sql,
		duration: result.duration,
		rowCount: result.rowCount,
		notes: `Date: ${targetDate}`,
	});
}

// Query 5: Cache Health Monitoring
function query5CacheHealth() {
	const sql = `SELECT chain_slug, max(target_date) AS target_date FROM prices GROUP BY chain_slug`;

	const result = chQuery(sql);

	results.push({
		name: "Query 5: Cache Health Monitoring (All Chains)",
		sql,
		duration: result.duration,
		rowCount: result.rowCount,
	});
}

// PostgreSQL Queries
function pgQuery1SearchItems() {
	const sql = `SELECT id, name, brand, category, subcategory, chain_slug, external_id, unit, unit_quantity, image_url
FROM retailer_items
WHERE (name ILIKE '%mleko%' OR brand ILIKE '%mleko%')
ORDER BY name
LIMIT 20`;

	const result = pgQuery(sql);

	results.push({
		name: "PG Query 1: Search Items by Name/Brand",
		sql,
		duration: result.duration,
		rowCount: result.rowCount,
		notes: "Search term: 'mleko'",
	});
}

function pgQuery2StoresByChain() {
	const sql = `SELECT s.id, s.name, s.city, s.is_virtual, c.slug AS chain_slug, c.name AS chain_name
FROM stores s
INNER JOIN chains c ON s.chain_slug = c.slug
WHERE s.chain_slug = 'konzum'
ORDER BY s.name`;

	const result = pgQuery(sql);

	results.push({
		name: "PG Query 2: Get Stores by Chain",
		sql,
		duration: result.duration,
		rowCount: result.rowCount,
	});
}

function pgQuery3BarcodeLookup() {
	const sql = `SELECT rib.barcode, ri.name, ri.brand, ri.chain_slug
FROM retailer_item_barcodes rib
INNER JOIN retailer_items ri ON rib.retailer_item_id = ri.id
LIMIT 100`;

	const result = pgQuery(sql);

	results.push({
		name: "PG Query 3: Barcode Lookup",
		sql,
		duration: result.duration,
		rowCount: result.rowCount,
	});
}

function pgQuery4DataQuality() {
	const sql = `SELECT
    c.slug AS chain_slug,
    c.name AS chain_name,
    COUNT(DISTINCT s.id) AS store_count,
    COUNT(DISTINCT ri.id) AS item_count
FROM chains c
LEFT JOIN stores s ON s.chain_slug = c.slug
LEFT JOIN retailer_items ri ON ri.chain_slug = c.slug
GROUP BY c.slug, c.name
ORDER BY c.name`;

	const result = pgQuery(sql);

	results.push({
		name: "PG Query 4: Data Quality Overview",
		sql,
		duration: result.duration,
		rowCount: result.rowCount,
	});
}

// ============================================================================
// Additional Stats Queries
// ============================================================================

interface ChainStats {
	chain: string;
	totalRows: number;
	uniqueItems: number;
	uniqueStores: number;
	dateRange: string;
	availableCount: number;
	unavailableCount: number;
	coverage: number;
}

function getChainStats(): ChainStats[] {
	const stats: ChainStats[] = [];
	const chains = getChains();

	for (const chain of chains) {
		const [
			totalRows,
			uniqueItems,
			uniqueStores,
			dateRange,
			priceStatus,
		] = [
			chQuery(`SELECT count() AS count FROM prices WHERE chain_slug = '${chain.slug}'`),
			chQuery(`SELECT uniqExact(retailer_item_id) AS count FROM prices WHERE chain_slug = '${chain.slug}'`),
			chQuery(`SELECT uniqExact(store_id) AS count FROM prices WHERE chain_slug = '${chain.slug}'`),
			chQuery(`SELECT min(target_date) AS min, max(target_date) AS max FROM prices WHERE chain_slug = '${chain.slug}'`),
			chQuery(`SELECT price_status AS status, count() AS count FROM prices WHERE chain_slug = '${chain.slug}' GROUP BY price_status`),
		];

		const total = Number.parseInt((totalRows.data[0] as any)?.count || "0", 10);
		const items = Number.parseInt((uniqueItems.data[0] as any)?.count || "0", 10);
		const stores = Number.parseInt((uniqueStores.data[0] as any)?.count || "0", 10);

		let available = 0;
		let unavailable = 0;
		for (const row of priceStatus.data as any[]) {
			const count = Number.parseInt(row?.count || "0", 10);
			if (row?.status === "available") available = count;
			else if (row?.status === "unavailable") unavailable = count;
		}

		const coverage = total > 0 ? (available / total) * 100 : 0;
		const dr = dateRange.data[0] as any;
		const dateStr = dr?.min && dr?.max ? `${dr.min} to ${dr.max}` : "No data";

		stats.push({
			chain: chain.name,
			totalRows: total,
			uniqueItems: items,
			uniqueStores: stores,
			dateRange: dateStr,
			availableCount: available,
			unavailableCount: unavailable,
			coverage,
		});
	}

	return stats;
}

// ============================================================================
// Main
// ============================================================================

function main() {
	console.log("=".repeat(70));
	console.log("PRICE DATA QUALITY AND QUERY PERFORMANCE BENCHMARK");
	console.log("=".repeat(70));
	console.log();

	const startTime = performance.now();

	// Get chains
	console.log("Fetching chains...");
	const chains = getChains();
	console.log(`Found ${chains.length} chains: ${chains.map((c) => c.slug).join(", ")}\n`);

	// Run ClickHouse queries for each chain
	console.log("Running ClickHouse queries...\n");
	for (const chain of chains) {
		console.log(`  Processing ${chain.name} (${chain.slug})...`);
		query1LatestPricesByStore(chain.slug);
		query2CrossStoreComparison(chain.slug);
		query3BasketOptimization(chain.slug);
		query4StoreCoverage(chain.slug);
	}

	console.log("  Running cache health query...");
	query5CacheHealth();
	console.log("  Done\n");

	// Run PostgreSQL queries
	console.log("Running PostgreSQL queries...\n");
	console.log("  Search items...");
	pgQuery1SearchItems();
	console.log("  Stores by chain...");
	pgQuery2StoresByChain();
	console.log("  Barcode lookup...");
	pgQuery3BarcodeLookup();
	console.log("  Data quality overview...");
	pgQuery4DataQuality();
	console.log("  Done\n");

	// Get chain stats
	console.log("Gathering chain statistics...");
	const chainStats = getChainStats();

	const totalDuration = performance.now() - startTime;

	// Print report
	console.log();
	console.log("=".repeat(70));
	console.log("BENCHMARK RESULTS");
	console.log("=".repeat(70));
	console.log();
	console.log(`Total execution time: ${totalDuration.toFixed(2)}ms`);
	console.log();

	// Chain Stats Table
	console.log("-".repeat(70));
	console.log("CHAIN STATISTICS");
	console.log("-".repeat(70));
	console.log();
	console.log(`{"Chain":<20} {"Total Rows":<15} {"Items":<12} {"Stores":<8} {"Coverage":<10}`);
	console.log("-".repeat(70));
	for (const stat of chainStats) {
		console.log(
			`${stat.chain.padEnd(20)} ${stat.totalRows.toLocaleString().padStart(15)} ${stat.uniqueItems.toLocaleString().padStart(12)} ${stat.uniqueStores.toString().padStart(8)} ${(stat.coverage.toFixed(1) + "%").padStart(10)}`
		);
	}
	console.log();

	// Query Results Table
	console.log("-".repeat(70));
	console.log("QUERY PERFORMANCE RESULTS");
	console.log("-".repeat(70));
	console.log();
	console.log(`{"Query":<50} {"Time":<10} {"Rows":<10}`);
	console.log("-".repeat(70));

	for (const result of results) {
		const name = result.name.length > 48 ? result.name.substring(0, 45) + "..." : result.name;
		const time = `${result.duration.toFixed(2)}ms`;
		const rows = result.rowCount.toLocaleString();
		console.log(`${name.padEnd(50)} ${time.padStart(10)} ${rows.padStart(10)}`);
		if (result.notes) {
			console.log(`  → ${result.notes}`);
		}
	}
	console.log();

	// Summary
	console.log("-".repeat(70));
	console.log("SUMMARY");
	console.log("-".repeat(70));
	console.log();

	const chResults = results.filter((r) => !r.name.startsWith("PG"));
	const pgResults = results.filter((r) => r.name.startsWith("PG"));

	const avgChTime = chResults.reduce((sum, r) => sum + r.duration, 0) / chResults.length;
	const avgPgTime = pgResults.reduce((sum, r) => sum + r.duration, 0) / pgResults.length;

	console.log(`ClickHouse Queries: ${chResults.length}`);
	console.log(`  Average time: ${avgChTime.toFixed(2)}ms`);
	console.log(`  Total rows: ${chResults.reduce((sum, r) => sum + r.rowCount, 0).toLocaleString()}`);
	console.log();
	console.log(`PostgreSQL Queries: ${pgResults.length}`);
	console.log(`  Average time: ${avgPgTime.toFixed(2)}ms`);
	console.log(`  Total rows: ${pgResults.reduce((sum, r) => sum + r.rowCount, 0).toLocaleString()}`);
	console.log();

	// Write to file
	let report = "# Price Data Quality and Query Performance Benchmark\n\n";
	report += `Generated: ${new Date().toISOString()}\n`;
	report += `Total execution time: ${totalDuration.toFixed(2)}ms\n\n`;

	report += "## Chain Statistics\n\n";
	report += "| Chain | Total Rows | Items | Stores | Coverage |\n";
	report += "|-------|------------|-------|--------|----------|\n";
	for (const stat of chainStats) {
		report += `| ${stat.chain} | ${stat.totalRows.toLocaleString()} | ${stat.uniqueItems.toLocaleString()} | ${stat.uniqueStores} | ${stat.coverage.toFixed(1)}% |\n`;
	}
	report += "\n";

	report += "## Query Performance Results\n\n";
	report += "| Query | Time (ms) | Rows |\n";
	report += "|-------|-----------|------|\n";
	for (const result of results) {
		report += `| ${result.name} | ${result.duration.toFixed(2)} | ${result.rowCount} |\n`;
	}
	report += "\n";

	report += "## Summary\n\n";
	report += `- ClickHouse: ${chResults.length} queries, avg ${avgChTime.toFixed(2)}ms\n`;
	report += `- PostgreSQL: ${pgResults.length} queries, avg ${avgPgTime.toFixed(2)}ms\n\n`;

	report += "## Detailed SQL with Timings\n\n";
	for (const result of results) {
		report += `### ${result.name}\n\n`;
		report += `**Time**: ${result.duration.toFixed(2)}ms | **Rows**: ${result.rowCount}\n`;
		if (result.notes) {
			report += `**Notes**: ${result.notes}\n`;
		}
		report += "\n```sql\n" + result.sql + "\n```\n\n";
	}

	require("node:fs").writeFileSync("/workspace/shop.md", report);
	console.log("Report written to shop.md");
}

main();
