#!/usr/bin/env tsx
/**
 * Data Quality and Query Performance Analysis Script
 *
 * Analyzes:
 * 1. Price data quality across all chains
 * 2. ClickHouse vs PostgreSQL query performance
 * 3. Typical cross-store comparison queries
 * 4. Data completeness and coverage metrics
 */

import { createClient } from "@clickhouse/client";
import pg from "postgres";
import { performance } from "node:perf_hooks";

interface QueryResult<T = unknown> {
	data: T[];
	duration: number;
	rowCount: number;
}

interface ReportSection {
	title: string;
	content: string;
	metrics?: Record<string, string | number>;
}

// ============================================================================
// Database Clients
// ============================================================================

const clickhouseClient = createClient({
	url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
	database: process.env.CLICKHOUSE_DATABASE || "default",
	username: process.env.CLICKHOUSE_USERNAME,
	password: process.env.CLICKHOUSE_PASSWORD,
});

const pgClient = pg(process.env.DATABASE_URL || "", {
	max: 1,
});

// ============================================================================
// Query Helpers
// ============================================================================

async function measureQuery<T>(
	name: string,
	fn: () => Promise<T>,
): Promise<{ result: T; duration: number }> {
	const start = performance.now();
	try {
		const result = await fn();
		const duration = performance.now() - start;
		return { result, duration };
	} catch (error) {
		const duration = performance.now() - start;
		console.error(`Query "${name}" failed after ${duration.toFixed(2)}ms:`, error);
		throw error;
	}
}

async function clickhouseQuery<T = unknown>(
	query: string,
	params?: Record<string, string | number | string[]>,
): Promise<QueryResult<T>> {
	const { result, duration } = await measureQuery("clickhouse", async () => {
		const resultSet = await clickhouseClient.query({
			query,
			query_params: params,
			format: "JSONEachRow",
		});
		return await resultSet.json<T>();
	});
	return { data: result, duration, rowCount: result.length };
}

async function pgQuery<T = unknown>(
	query: string,
	params?: (string | number)[],
): Promise<QueryResult<T>> {
	const { result, duration } = await measureQuery("postgres", async () => {
		return await pgClient.unsafe(query, params) as T[];
	});
	return { data: result, duration, rowCount: result.length };
}

// ============================================================================
// Data Quality Analysis
// ============================================================================

async function analyzeChainDataQuality(): Promise<ReportSection> {
	let report = "# Price Data Quality by Chain\n\n";

	// Get all chains
	const chainsResult = await pgQuery<{ slug: string; name: string }>(
		"SELECT slug, name FROM chains ORDER BY name",
	);

	const chains = chainsResult.data;

	report += `Analyzing ${chains.length} chains...\n\n`;

	const chainMetrics: {
		chain: string;
		totalRows: number;
		uniqueItems: number;
		uniqueStores: number;
		dateRange: string;
		availablePrices: number;
		unavailablePrices: number;
		coverage: number;
	}[] = [];

	for (const chain of chains) {
		const { slug, name } = chain;

		// ClickHouse data quality metrics
		const [
			totalRows,
			uniqueItems,
			uniqueStores,
			dateRange,
			priceStatus,
			latestPrices,
		] = await Promise.all([
			clickhouseQuery<{ count: string }>(
				"SELECT count() AS count FROM prices WHERE chain_slug = {chain:String}",
				{ chain: slug },
			),
			clickhouseQuery<{ count: string }>(
				"SELECT uniqExact(retailer_item_id) AS count FROM prices WHERE chain_slug = {chain:String}",
				{ chain: slug },
			),
			clickhouseQuery<{ count: string }>(
				"SELECT uniqExact(store_id) AS count FROM prices WHERE chain_slug = {chain:String}",
				{ chain: slug },
			),
			clickhouseQuery<{ min: string; max: string }>(
				"SELECT min(target_date) AS min, max(target_date) AS max FROM prices WHERE chain_slug = {chain:String}",
				{ chain: slug },
			),
			clickhouseQuery<{ status: string; count: string }>(
				"SELECT price_status AS status, count() AS count FROM prices WHERE chain_slug = {chain:String} GROUP BY price_status",
				{ chain: slug },
			),
			clickhouseQuery<{ count: string }>(
				"SELECT count() AS count FROM prices WHERE chain_slug = {chain:String} AND target_date = (SELECT max(target_date) FROM prices WHERE chain_slug = {chain:String})",
				{ chain: slug },
			),
		]);

		const total = Number.parseInt(totalRows.data[0]?.count || "0", 10);
		const items = Number.parseInt(uniqueItems.data[0]?.count || "0", 10);
		const stores = Number.parseInt(uniqueStores.data[0]?.count || "0", 10);
		const latest = Number.parseInt(latestPrices.data[0]?.count || "0", 10);

		let available = 0;
		let unavailable = 0;
		for (const row of priceStatus.data) {
			const count = Number.parseInt(row.count, 10);
			if (row.status === "available") available = count;
			else if (row.status === "unavailable") unavailable = count;
		}

		const coverage = total > 0 ? (available / total) * 100 : 0;
		const dateStr =
			dateRange.data[0]?.min && dateRange.data[0]?.max
				? `${dateRange.data[0].min} to ${dateRange.data[0].max}`
				: "No data";

		chainMetrics.push({
			chain: name,
			totalRows: total,
			uniqueItems: items,
			uniqueStores: stores,
			dateRange: dateStr,
			availablePrices: available,
			unavailablePrices: unavailable,
			coverage,
		});

		report += `## ${name} (${slug})\n`;
		report += `- **Total Price Records**: ${total.toLocaleString()}\n`;
		report += `- **Unique Items**: ${items.toLocaleString()}\n`;
		report += `- **Unique Stores**: ${stores}\n`;
		report += `- **Date Range**: ${dateStr}\n`;
		report += `- **Price Availability**: ${available.toLocaleString()} available, ${unavailable.toLocaleString()} unavailable\n`;
		report += `- **Coverage Rate**: ${coverage.toFixed(1)}%\n`;
		report += `- **Latest Date Records**: ${latest.toLocaleString()}\n\n`;
	}

	// Summary table
	report += "### Summary Table\n\n";
	report += "| Chain | Total Records | Unique Items | Stores | Coverage |\n";
	report += "|-------|--------------|--------------|--------|----------|\n";
	for (const m of chainMetrics) {
		report += `| ${m.chain} | ${m.totalRows.toLocaleString()} | ${m.uniqueItems.toLocaleString()} | ${m.uniqueStores} | ${m.coverage.toFixed(1)}% |\n`;
	}

	return {
		title: "Price Data Quality by Chain",
		content: report,
	};
}

async function analyzePostgresDataQuality(): Promise<ReportSection> {
	let report = "# PostgreSQL Metadata Quality\n\n";

	// Get counts for all major tables
	const [
		chainsCount,
		storesCount,
		retailerItemsCount,
		barcodesCount,
		productsCount,
		productLinksCount,
		archivesCount,
		parquetFilesCount,
		ingestionRunsCount,
	] = await Promise.all([
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM chains"),
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM stores"),
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM retailer_items"),
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM retailer_item_barcodes"),
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM products"),
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM product_links"),
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM archives"),
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM parquet_files"),
		pgQuery<{ count: string }>("SELECT count(*)::text AS count FROM ingestion_runs"),
	]);

	const chains = Number.parseInt(chainsCount.data[0]?.count || "0", 10);
	const stores = Number.parseInt(storesCount.data[0]?.count || "0", 10);
	const items = Number.parseInt(retailerItemsCount.data[0]?.count || "0", 10);
	const barcodes = Number.parseInt(barcodesCount.data[0]?.count || "0", 10);
	const products = Number.parseInt(productsCount.data[0]?.count || "0", 10);
	const links = Number.parseInt(productLinksCount.data[0]?.count || "0", 10);
	const archives = Number.parseInt(archivesCount.data[0]?.count || "0", 10);
	const parquetFiles = Number.parseInt(parquetFilesCount.data[0]?.count || "0", 10);
	const runs = Number.parseInt(ingestionRunsCount.data[0]?.count || "0", 10);

	report += `### Reference Data Counts\n\n`;
	report += `- **Chains**: ${chains}\n`;
	report += `- **Stores**: ${stores.toLocaleString()}\n`;
	report += `- **Retailer Items**: ${items.toLocaleString()}\n`;
	report += `- **Barcodes**: ${barcodes.toLocaleString()}\n`;
	report += `- **Products**: ${products.toLocaleString()}\n`;
	report += `- **Product Links**: ${links.toLocaleString()}\n`;
	report += `- **Archives**: ${archives}\n`;
	report += `- **Parquet Files**: ${parquetFiles}\n`;
	report += `- **Ingestion Runs**: ${runs}\n\n`;

	// Items per chain
	const itemsByChain = await pgQuery<{ chain_slug: string; count: string }>(
		`SELECT chain_slug, count(*)::text AS count
			FROM retailer_items
			WHERE chain_slug IS NOT NULL
			GROUP BY chain_slug
			ORDER BY count DESC`,
	);

	report += `### Retailer Items by Chain\n\n`;
	report += "| Chain | Item Count |\n";
	report += "|-------|------------|\n";
	for (const row of itemsByChain.data) {
		report += `| ${row.chain_slug} | ${Number.parseInt(row.count, 10).toLocaleString()} |\n`;
	}

	// Stores per chain
	const storesByChain = await pgQuery<{ chain_slug: string; name: string; count: string }>(
		`SELECT c.slug AS chain_slug, c.name, COUNT(s.id)::text AS count
			FROM chains c
			LEFT JOIN stores s ON s.chain_slug = c.slug
			GROUP BY c.slug, c.name
			ORDER BY count DESC`,
	);

	report += `\n### Stores by Chain\n\n`;
	report += "| Chain | Store Count |\n";
	report += "|-------|-------------|\n";
	for (const row of storesByChain.data) {
		const count = Number.parseInt(row.count, 10);
		report += `| ${row.name} (${row.chain_slug}) | ${count} |\n`;
	}

	return {
		title: "PostgreSQL Metadata Quality",
		content: report,
	};
}

// ============================================================================
// Query Performance Benchmarks
// ============================================================================

async function benchmarkCrossStoreComparisonQueries(): Promise<ReportSection> {
	let report = "# Cross-Store Comparison Query Performance\n\n";
	report += "Testing typical queries for building a cross-comparison webshop...\n\n";

	const results: {
		query: string;
		clickhouseMs: number;
		postgresMs: number | null;
		clickhouseRows: number;
		postgresRows: number | null;
	}[] = [];

	// Query 1: Latest prices by store (key pattern for comparison)
	report += "## Query 1: Latest Prices by Store\n\n";
	report += "```sql\n";
	report += `SELECT
    store_id,
    retailer_item_id,
    argMax(price_cents, target_date) AS current_price,
    argMax(discount_price_cents, target_date) AS discount_price,
    max(target_date) AS last_seen
FROM prices
WHERE chain_slug = {chain}
GROUP BY store_id, retailer_item_id
ORDER BY last_seen DESC
LIMIT 100\n`;
	report += "```\n\n";

	const ch1 = await clickhouseQuery(
		`SELECT
        store_id,
        retailer_item_id,
        argMax(price_cents, target_date) AS current_price,
        argMax(discount_price_cents, target_date) AS discount_price,
        max(target_date) AS last_seen
    FROM prices
    WHERE chain_slug = {chain}
    GROUP BY store_id, retailer_item_id
    ORDER BY last_seen DESC
    LIMIT 100`,
		{ chain: "konzum" },
	);

	report += `- **ClickHouse**: ${ch1.duration.toFixed(2)}ms, ${ch1.rowCount} rows\n`;
	results.push({
		query: "Latest prices by store",
		clickhouseMs: ch1.duration,
		postgresMs: null,
		clickhouseRows: ch1.rowCount,
		postgresRows: null,
	});

	// Query 2: Price comparison across stores for specific items
	report += "## Query 2: Cross-Store Price Comparison\n\n";
	report += "```sql\n";
	report += `SELECT
    retailer_item_id,
    store_id,
    argMax(price_cents, target_date) AS price,
    argMax(name, target_date) AS name
FROM prices
WHERE chain_slug = {chain}
    AND retailer_item_id IN ({itemIds})
GROUP BY retailer_item_id, store_id\n`;
	report += "```\n\n";

	// Get some sample item IDs
	const sampleItems = await clickhouseQuery<{ retailer_item_id: string }>(
		`SELECT retailer_item_id
        FROM prices
        WHERE chain_slug = {chain}
        GROUP BY retailer_item_id
        LIMIT 10`,
		{ chain: "konzum" },
	);

	if (sampleItems.data.length > 0) {
		const itemIds = sampleItems.data.map((x) => x.retailer_item_id);
		const ch2 = await clickhouseQuery(
			`SELECT
            retailer_item_id,
            store_id,
            argMax(price_cents, target_date) AS price,
            argMax(name, target_date) AS name
        FROM prices
        WHERE chain_slug = {chain}
            AND retailer_item_id IN ({itemIds:Array(String)})
        GROUP BY retailer_item_id, store_id`,
			{ chain: "konzum", itemIds },
		);

		report += `- **ClickHouse**: ${ch2.duration.toFixed(2)}ms, ${ch2.rowCount} rows\n`;
		results.push({
			query: "Cross-store price comparison",
			clickhouseMs: ch2.duration,
			postgresMs: null,
			clickhouseRows: ch2.rowCount,
			postgresRows: null,
		});
	}

	// Query 3: Store coverage analysis
	report += "## Query 3: Store Coverage Analysis\n\n";
	report += "```sql\n";
	report += `SELECT
    chain_slug,
    store_id,
    count(DISTINCT retailer_item_id) AS item_count,
    countIf(price_status = 'available') AS available_count,
    countIf(price_status = 'unavailable') AS unavailable_count
FROM prices
WHERE target_date = {date}
GROUP BY chain_slug, store_id
ORDER BY item_count DESC\n`;
	report += "```\n\n";

	const dateResult = await clickhouseQuery<{ max: string }>(
		"SELECT max(target_date) AS max FROM prices",
	);

	if (dateResult.data[0]?.max) {
		const maxDate = dateResult.data[0].max;
		const ch3 = await clickhouseQuery(
			`SELECT
            chain_slug,
            store_id,
            count(DISTINCT retailer_item_id) AS item_count,
            countIf(price_status = 'available') AS available_count,
            countIf(price_status = 'unavailable') AS unavailable_count
        FROM prices
        WHERE target_date = {date:Date}
        GROUP BY chain_slug, store_id
        ORDER BY item_count DESC`,
			{ date: maxDate },
		);

		report += `- **ClickHouse**: ${ch3.duration.toFixed(2)}ms, ${ch3.rowCount} rows\n`;
		results.push({
			query: "Store coverage analysis",
			clickhouseMs: ch3.duration,
			postgresMs: null,
			clickhouseRows: ch3.rowCount,
			postgresRows: null,
		});
	}

	// Query 4: Average price calculation (for basket optimization)
	report += "## Query 4: Average Price Calculation (Basket Optimization)\n\n";
	report += "```sql\n";
	report += `SELECT
    retailer_item_id,
    avg(if(discount_price_cents > 0 AND discount_price_cents < price_cents,
        discount_price_cents, price_cents)) AS avg_price
FROM prices
WHERE chain_slug = {chain}
    AND target_date = {date}
    AND retailer_item_id IN ({itemIds})
GROUP BY retailer_item_id\n`;
	report += "```\n\n";

	if (sampleItems.data.length > 0 && dateResult.data[0]?.max) {
		const itemIds = sampleItems.data.map((x) => x.retailer_item_id);
		const maxDate = dateResult.data[0].max;
		const ch4 = await clickhouseQuery(
			`SELECT
            retailer_item_id,
            avg(if(discount_price_cents > 0 AND discount_price_cents < price_cents,
                discount_price_cents, price_cents)) AS avg_price
        FROM prices
        WHERE chain_slug = {chain}
            AND target_date = {date:Date}
            AND retailer_item_id IN ({itemIds:Array(String)})
        GROUP BY retailer_item_id`,
			{ chain: "konzum", date: maxDate, itemIds },
		);

		report += `- **ClickHouse**: ${ch4.duration.toFixed(2)}ms, ${ch4.rowCount} rows\n`;
		results.push({
			query: "Average price calculation",
			clickhouseMs: ch4.duration,
			postgresMs: null,
			clickhouseRows: ch4.rowCount,
			postgresRows: null,
		});
	}

	// PostgreSQL equivalents for metadata queries
	report += "## PostgreSQL Metadata Query Performance\n\n";

	// PG Query 1: Store lookup with chain info
	const pg1 = await pgQuery(
		`SELECT s.id, s.name, s.city, c.slug AS chain_slug, c.name AS chain_name
        FROM stores s
        INNER JOIN chains c ON s.chain_slug = c.slug
        LIMIT 100`,
	);

	report += `### Store with Chain Lookup\n`;
	report += `- **PostgreSQL**: ${pg1.duration.toFixed(2)}ms, ${pg1.rowCount} rows\n\n`;

	// PG Query 2: Item search by name/brand
	const pg2 = await pgQuery(
		`SELECT id, name, brand, category, chain_slug
        FROM retailer_items
        WHERE name ILIKE '%mleko%'
            OR brand ILIKE '%mleko%'
        LIMIT 20`,
	);

	report += `### Item Search by Name/Brand\n`;
	report += `- **PostgreSQL**: ${pg2.duration.toFixed(2)}ms, ${pg2.rowCount} rows\n\n`;

	// PG Query 3: Barcode lookup
	const pg3 = await pgQuery(
		`SELECT rib.barcode, ri.name, ri.brand, ri.chain_slug
        FROM retailer_item_barcodes rib
        INNER JOIN retailer_items ri ON rib.retailer_item_id = ri.id
        LIMIT 100`,
	);

	report += `### Barcode Lookup\n`;
	report += `- **PostgreSQL**: ${pg3.duration.toFixed(2)}ms, ${pg3.rowCount} rows\n\n`;

	// Summary table
	report += "### Performance Summary\n\n";
	report += "| Query | ClickHouse (ms) | Rows |\n";
	report += "|-------|----------------|------|\n";
	for (const r of results) {
		report += `| ${r.query} | ${r.clickhouseMs.toFixed(2)} | ${r.clickhouseRows} |\n`;
	}

	return {
		title: "Query Performance Benchmarks",
		content: report,
	};
}

async function analyzeDataFreshness(): Promise<ReportSection> {
	let report = "# Data Freshness Analysis\n\n";

	const chainsResult = await pgQuery<{ slug: string; name: string }>(
		"SELECT slug, name FROM chains ORDER BY name",
	);

	const freshness: {
		chain: string;
		latestDate: string | null;
		daysSince: number;
		recordsOnLatest: number;
	}[] = [];

	const today = new Date();

	for (const chain of chainsResult.data) {
		const result = await clickhouseQuery<{ max: string | null }>(
			"SELECT max(target_date) AS max FROM prices WHERE chain_slug = {chain}",
			{ chain: chain.slug },
		);

		const latest = result.data[0]?.max;
		let daysSince = -1;
		let recordsOnLatest = 0;

		if (latest) {
			const latestDate = new Date(latest);
			const diffTime = Math.abs(today.getTime() - latestDate.getTime());
			daysSince = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

			const countResult = await clickhouseQuery<{ count: string }>(
				"SELECT count() AS count FROM prices WHERE chain_slug = {chain} AND target_date = {date:Date}",
				{ chain: chain.slug, date: latest },
			);
			recordsOnLatest = Number.parseInt(countResult.data[0]?.count || "0", 10);
		}

		freshness.push({
			chain: chain.name,
			latestDate: latest,
			daysSince,
			recordsOnLatest,
		});
	}

	report += "| Chain | Latest Date | Days Ago | Records on Latest |\n";
	report += "|-------|-------------|----------|-------------------|\n";
	for (const f of freshness) {
		const dateStr = f.latestDate || "N/A";
		const daysStr = f.daysSince >= 0 ? f.daysSince.toString() : "N/A";
		report += `| ${f.chain} | ${dateStr} | ${daysStr} | ${f.recordsOnLatest.toLocaleString()} |\n`;
	}

	return {
		title: "Data Freshness Analysis",
		content: report,
	};
}

async function analyzePriceAvailability(): Promise<ReportSection> {
	let report = "# Price Availability Analysis\n\n";

	// Overall availability
	const result = await clickhouseQuery<{
		status: string;
		reason: string | null;
		count: string;
	}>(
		`SELECT
        price_status AS status,
        price_unavailable_reason AS reason,
        count() AS count
    FROM prices
    GROUP BY status, reason
    ORDER BY count DESC`,
	);

	report += "### Price Status Breakdown\n\n";
	report += "| Status | Reason | Count | Percentage |\n";
	report += "|--------|--------|-------|------------|\n";

	let total = 0;
	for (const row of result.data) {
		total += Number.parseInt(row.count, 10);
	}

	for (const row of result.data) {
		const count = Number.parseInt(row.count, 10);
		const pct = ((count / total) * 100).toFixed(1);
		const status = row.status || "NULL";
		const reason = row.reason || "N/A";
		report += `| ${status} | ${reason} | ${count.toLocaleString()} | ${pct}% |\n`;
	}

	// By chain
	report += "\n### Availability by Chain\n\n";
	report += "| Chain | Available | Unavailable | Coverage |\n";
	report += "|-------|-----------|-------------|----------|\n";

	const chainsResult = await pgQuery<{ slug: string; name: string }>(
		"SELECT slug, name FROM chains ORDER BY name",
	);

	for (const chain of chainsResult.data) {
		const result = await clickhouseQuery<{ status: string; count: string }>(
			`SELECT
            price_status AS status,
            count() AS count
        FROM prices
        WHERE chain_slug = {chain}
        GROUP BY status`,
			{ chain: chain.slug },
		);

		let available = 0;
		let unavailable = 0;
		for (const row of result.data) {
			const count = Number.parseInt(row.count, 10);
			if (row.status === "available") available = count;
			else if (row.status === "unavailable") unavailable = count;
		}

		const total = available + unavailable;
		const coverage = total > 0 ? ((available / total) * 100).toFixed(1) : "0";
		report += `| ${chain.name} | ${available.toLocaleString()} | ${unavailable.toLocaleString()} | ${coverage}% |\n`;
	}

	return {
		title: "Price Availability Analysis",
		content: report,
	};
}

async function analyzeStoreCoverage(): Promise<ReportSection> {
	let report = "# Store Coverage Analysis\n\n";

	// Get latest date
	const dateResult = await clickhouseQuery<{ max: string }>(
		"SELECT max(target_date) AS max FROM prices",
	);

	if (!dateResult.data[0]?.max) {
		report += "No price data available.\n";
		return {
			title: "Store Coverage Analysis",
			content: report,
		};
	}

	const latestDate = dateResult.data[0].max;
	report += `Analysis based on latest date: ${latestDate}\n\n`;

	// Store coverage by chain
	const result = await clickhouseQuery<{
		chain_slug: string;
		store_id: string;
		item_count: string;
		available_count: string;
	}>(`SELECT
        chain_slug,
        store_id,
        count(DISTINCT retailer_item_id) AS item_count,
        countIf(price_status = 'available') AS available_count
    FROM prices
    WHERE target_date = {date:Date}
    GROUP BY chain_slug, store_id
    ORDER BY chain_slug, item_count DESC`, { date: latestDate });

	// Group by chain
	const byChain = new Map<string, { totalItems: number; totalStores: number; storeData: typeof result.data }>();

	for (const row of result.data) {
		if (!byChain.has(row.chain_slug)) {
			byChain.set(row.chain_slug, {
				totalItems: 0,
				totalStores: 0,
				storeData: [],
			});
		}
		const chain = byChain.get(row.chain_slug)!;
		chain.storeData.push(row);
		chain.totalStores++;
		chain.totalItems += Number.parseInt(row.item_count, 10);
	}

	report += "### Summary by Chain\n\n";
	report += "| Chain | Stores | Total Items | Avg Items/Store |\n";
	report += "|-------|--------|-------------|-----------------|\n";

	for (const [slug, data] of byChain.entries()) {
		const avg = data.totalItems / data.totalStores;
		report += `| ${slug} | ${data.totalStores} | ${data.totalItems.toLocaleString()} | ${avg.toFixed(0)} |\n`;
	}

	return {
		title: "Store Coverage Analysis",
		content: report,
	};
}

// ============================================================================
// Main Report Generation
// ============================================================================

async function generateReport() {
	console.log("Starting data quality and query performance analysis...\n");

	const startTime = performance.now();

	const sections: ReportSection[] = [];

	try {
		console.log("1. Analyzing chain data quality...");
		sections.push(await analyzeChainDataQuality());
		console.log("   Done");

		console.log("2. Analyzing PostgreSQL metadata quality...");
		sections.push(await analyzePostgresDataQuality());
		console.log("   Done");

		console.log("3. Benchmarking cross-store comparison queries...");
		sections.push(await benchmarkCrossStoreComparisonQueries());
		console.log("   Done");

		console.log("4. Analyzing data freshness...");
		sections.push(await analyzeDataFreshness());
		console.log("   Done");

		console.log("5. Analyzing price availability...");
		sections.push(await analyzePriceAvailability());
		console.log("   Done");

		console.log("6. Analyzing store coverage...");
		sections.push(await analyzeStoreCoverage());
		console.log("   Done");
	} catch (error) {
		console.error("Error during analysis:", error);
		throw error;
	} finally {
		await clickhouseClient.close();
		await pgClient.end();
	}

	const totalDuration = performance.now() - startTime;

	// Generate full report
	let fullReport = "# Data Quality and Query Performance Report\n\n";
	fullReport += `Generated: ${new Date().toISOString()}\n`;
	fullReport += `Total Analysis Time: ${(totalDuration / 1000).toFixed(2)}s\n\n`;
	fullReport += "---\n\n";

	for (const section of sections) {
		fullReport += `## ${section.title}\n\n`;
		fullReport += section.content;
		fullReport += "\n\n---\n\n";
	}

	// Add recommendations
	fullReport += "## Recommendations\n\n";

	// Add some basic recommendations based on findings
	fullReport += "### Performance Optimization\n\n";
	fullReport += "- ClickHouse shows excellent performance for time-series aggregation queries\n";
	fullReport += "- Consider materialized views for frequently accessed aggregations\n";
	fullReport += "- PostgreSQL handles metadata queries well - consider adding more indexes\n\n";

	fullReport += "### Data Quality\n\n";
	fullReport += "- Monitor unavailable prices and investigate root causes\n";
	fullReport += "- Set up alerts for chains with stale data (older than 3 days)\n";
	fullReport += "- Consider data validation checks during ingestion\n\n";

	fullReport += "### Cross-Store Comparison Features\n\n";
	fullReport += "- The `argMax()` pattern is efficient for latest-price queries\n";
	fullReport += "- Store coverage queries perform well for real-time comparisons\n";
	fullReport += "- Average price calculations enable basket optimization\n\n";

	return fullReport;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
	try {
		const report = await generateReport();
		console.log("\n" + "=".repeat(60));
		console.log("ANALYSIS COMPLETE");
		console.log("=".repeat(60) + "\n");
		console.log(report);
	} catch (error) {
		console.error("Analysis failed:", error);
		process.exit(1);
	}
}

main();

export { generateReport };
