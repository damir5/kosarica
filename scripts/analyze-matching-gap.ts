import { sql } from "drizzle-orm";
import { getDatabase } from "../src/db";

async function analyzeMatchingGap(): Promise<void> {
	const db = getDatabase();

	console.log("═══════════════════════════════════════════════════════════════");
	console.log("          PRODUCT MATCHING GAP ANALYSIS");
	console.log("═══════════════════════════════════════════════════════════════\n");

	// 1. Overall counts
	const [totals] = await db.execute(sql`
		SELECT
			(SELECT COUNT(*) FROM retailer_items) as total_items,
			(SELECT COUNT(*) FROM products) as total_products,
			(SELECT COUNT(*) FROM product_links) as total_links,
			(SELECT COUNT(*) FROM canonical_barcodes) as total_canonical_barcodes,
			(SELECT COUNT(*) FROM retailer_item_barcodes) as total_item_barcodes,
			(SELECT COUNT(DISTINCT retailer_item_id) FROM product_links) as linked_items,
			(SELECT COUNT(*) FROM chains) as total_chains
	`);
	console.log("--- OVERVIEW ---");
	console.log(`Total retailer items:     ${totals.total_items}`);
	console.log(`Total canonical products: ${totals.total_products}`);
	console.log(`Total product links:      ${totals.total_links}`);
	console.log(`Linked items:             ${totals.linked_items}`);
	console.log(`Unlinked items:           ${Number(totals.total_items) - Number(totals.linked_items)}`);
	console.log(`Match rate:               ${((Number(totals.linked_items) / Number(totals.total_items)) * 100).toFixed(1)}%`);
	console.log(`Canonical barcodes:       ${totals.total_canonical_barcodes}`);
	console.log(`Item barcodes:            ${totals.total_item_barcodes}\n`);

	// 2. Per-chain breakdown
	console.log("--- PER CHAIN BREAKDOWN ---");
	const chainBreakdown = await db.execute(sql`
		SELECT
			ri.chain_slug,
			COUNT(*) as total,
			COUNT(pl.id) as linked,
			COUNT(*) - COUNT(pl.id) as unlinked,
			ROUND(COUNT(pl.id)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as match_pct
		FROM retailer_items ri
		LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
		GROUP BY ri.chain_slug
		ORDER BY total DESC
	`);
	console.log(`${"Chain".padEnd(15)} ${"Total".padStart(8)} ${"Linked".padStart(8)} ${"Unlinked".padStart(10)} ${"Match%".padStart(8)}`);
	for (const row of chainBreakdown) {
		console.log(`${String(row.chain_slug).padEnd(15)} ${String(row.total).padStart(8)} ${String(row.linked).padStart(8)} ${String(row.unlinked).padStart(10)} ${String(row.match_pct || 0).padStart(7)}%`);
	}

	// 3. Barcode availability on unlinked items
	console.log("\n--- BARCODE AVAILABILITY ON UNLINKED ITEMS ---");
	const barcodeAvail = await db.execute(sql`
		SELECT
			ri.chain_slug,
			COUNT(*) as unlinked_total,
			COUNT(DISTINCT rib.retailer_item_id) as has_barcode,
			COUNT(*) - COUNT(DISTINCT rib.retailer_item_id) as no_barcode
		FROM retailer_items ri
		LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
		LEFT JOIN retailer_item_barcodes rib ON rib.retailer_item_id = ri.id
		WHERE pl.id IS NULL
		GROUP BY ri.chain_slug
		ORDER BY unlinked_total DESC
	`);
	console.log(`${"Chain".padEnd(15)} ${"Unlinked".padStart(10)} ${"HasBarcode".padStart(12)} ${"NoBarcode".padStart(11)}`);
	for (const row of barcodeAvail) {
		console.log(`${String(row.chain_slug).padEnd(15)} ${String(row.unlinked_total).padStart(10)} ${String(row.has_barcode).padStart(12)} ${String(row.no_barcode).padStart(11)}`);
	}

	// 4. Unit/quantity data availability
	console.log("\n--- UNIT & QUANTITY DATA AVAILABILITY ---");
	const unitAvail = await db.execute(sql`
		SELECT
			ri.chain_slug,
			COUNT(*) as total,
			SUM(CASE WHEN ri.unit IS NOT NULL AND ri.unit != '' THEN 1 ELSE 0 END) as has_unit,
			SUM(CASE WHEN ri.unit_quantity IS NOT NULL AND ri.unit_quantity != '' THEN 1 ELSE 0 END) as has_qty,
			SUM(CASE WHEN ri.brand IS NOT NULL AND ri.brand != '' THEN 1 ELSE 0 END) as has_brand,
			SUM(CASE WHEN ri.category IS NOT NULL AND ri.category != '' THEN 1 ELSE 0 END) as has_category
		FROM retailer_items ri
		GROUP BY ri.chain_slug
		ORDER BY total DESC
	`);
	console.log(`${"Chain".padEnd(15)} ${"Total".padStart(8)} ${"HasUnit".padStart(9)} ${"HasQty".padStart(9)} ${"HasBrand".padStart(10)} ${"HasCat".padStart(9)}`);
	for (const row of unitAvail) {
		console.log(`${String(row.chain_slug).padEnd(15)} ${String(row.total).padStart(8)} ${String(row.has_unit).padStart(9)} ${String(row.has_qty).padStart(9)} ${String(row.has_brand).padStart(10)} ${String(row.has_category).padStart(9)}`);
	}

	// 5. Unit price availability in store_item_state (may not exist yet)
	console.log("\n--- UNIT PRICE DATA IN STORE_ITEM_STATE ---");
	try {
		const unitPriceAvail = await db.execute(sql`
			SELECT
				ri.chain_slug,
				COUNT(*) as total_states,
				SUM(CASE WHEN sis.unit_price IS NOT NULL THEN 1 ELSE 0 END) as has_unit_price,
				SUM(CASE WHEN sis.unit_price_base_unit IS NOT NULL AND sis.unit_price_base_unit != '' THEN 1 ELSE 0 END) as has_base_unit,
				SUM(CASE WHEN sis.unit_price_base_quantity IS NOT NULL AND sis.unit_price_base_quantity != '' THEN 1 ELSE 0 END) as has_base_qty
			FROM store_item_state sis
			JOIN retailer_items ri ON ri.id = sis.retailer_item_id
			GROUP BY ri.chain_slug
			ORDER BY total_states DESC
		`);
		console.log(`${"Chain".padEnd(15)} ${"States".padStart(10)} ${"UnitPrice".padStart(11)} ${"BaseUnit".padStart(10)} ${"BaseQty".padStart(10)}`);
		for (const row of unitPriceAvail) {
			console.log(`${String(row.chain_slug).padEnd(15)} ${String(row.total_states).padStart(10)} ${String(row.has_unit_price).padStart(11)} ${String(row.has_base_unit).padStart(10)} ${String(row.has_base_qty).padStart(10)}`);
		}
	} catch {
		console.log("  (store_item_state table not available yet)");
	}

	// 6. Distinct units used
	console.log("\n--- DISTINCT UNITS USED ---");
	const distinctUnits = await db.execute(sql`
		SELECT unit, COUNT(*) as cnt
		FROM retailer_items
		WHERE unit IS NOT NULL AND unit != ''
		GROUP BY unit
		ORDER BY cnt DESC
		LIMIT 30
	`);
	for (const row of distinctUnits) {
		console.log(`  ${String(row.unit).padEnd(20)} ${String(row.cnt).padStart(8)}`);
	}

	// 6b. Distinct unit_price_base_unit values
	console.log("\n--- DISTINCT UNIT PRICE BASE UNITS (store_item_state) ---");
	try {
		const distinctBaseUnits = await db.execute(sql`
			SELECT unit_price_base_unit, COUNT(*) as cnt
			FROM store_item_state
			WHERE unit_price_base_unit IS NOT NULL AND unit_price_base_unit != ''
			GROUP BY unit_price_base_unit
			ORDER BY cnt DESC
			LIMIT 30
		`);
		for (const row of distinctBaseUnits) {
			console.log(`  ${String(row.unit_price_base_unit).padEnd(20)} ${String(row.cnt).padStart(8)}`);
		}
	} catch {
		console.log("  (store_item_state table not available yet)");
	}

	// 7. Sample unlinked items without barcodes (for manual matching analysis)
	console.log("\n--- SAMPLE UNLINKED ITEMS WITHOUT BARCODES (per chain, 10 each) ---");
	const chains = await db.execute(sql`SELECT DISTINCT chain_slug FROM retailer_items WHERE chain_slug IS NOT NULL ORDER BY chain_slug`);
	for (const chain of chains) {
		const samples = await db.execute(sql`
			SELECT ri.name, ri.brand, ri.category, ri.unit, ri.unit_quantity, ri.chain_slug, ri.external_id
			FROM retailer_items ri
			LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
			LEFT JOIN retailer_item_barcodes rib ON rib.retailer_item_id = ri.id
			WHERE pl.id IS NULL
			AND rib.id IS NULL
			AND ri.chain_slug = ${chain.chain_slug}
			LIMIT 10
		`);
		if (samples.length > 0) {
			console.log(`\n  [${chain.chain_slug}] (${samples.length} samples):`);
			for (const s of samples) {
				const parts = [s.name];
				if (s.brand) parts.push(`brand=${s.brand}`);
				if (s.category) parts.push(`cat=${s.category}`);
				if (s.unit) parts.push(`${s.unit_quantity || "?"}${s.unit}`);
				console.log(`    - ${parts.join(" | ")}`);
			}
		}
	}

	// 8. Sample unlinked items WITH barcodes (why aren't they matching?)
	console.log("\n--- SAMPLE UNLINKED ITEMS WITH BARCODES (10 samples) ---");
	const unmatchedWithBarcode = await db.execute(sql`
		SELECT ri.name, ri.brand, ri.chain_slug, rib.barcode,
			   ri.unit, ri.unit_quantity
		FROM retailer_items ri
		LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
		JOIN retailer_item_barcodes rib ON rib.retailer_item_id = ri.id
		WHERE pl.id IS NULL
		LIMIT 20
	`);
	for (const s of unmatchedWithBarcode) {
		console.log(`  ${String(s.chain_slug).padEnd(12)} barcode=${s.barcode} | ${s.name} | brand=${s.brand || "?"} | ${s.unit_quantity || "?"}${s.unit || "?"}`);
	}

	// 9. Product link confidence distribution
	console.log("\n--- LINK CONFIDENCE DISTRIBUTION ---");
	const confDist = await db.execute(sql`
		SELECT confidence, COUNT(*) as cnt
		FROM product_links
		GROUP BY confidence
		ORDER BY cnt DESC
	`);
	for (const row of confDist) {
		console.log(`  ${String(row.confidence || "null").padEnd(15)} ${String(row.cnt).padStart(8)}`);
	}

	// 10. Product match queue status
	console.log("\n--- MATCH QUEUE STATUS ---");
	const queueStatus = await db.execute(sql`
		SELECT status, decision, COUNT(*) as cnt
		FROM product_match_queue
		GROUP BY status, decision
		ORDER BY cnt DESC
	`);
	for (const row of queueStatus) {
		console.log(`  status=${String(row.status).padEnd(10)} decision=${String(row.decision || "null").padEnd(15)} count=${row.cnt}`);
	}

	// 11. How many unlinked items have similar names across chains?
	console.log("\n--- CROSS-CHAIN NAME OVERLAP (exact name matches, unlinked items) ---");
	const crossChain = await db.execute(sql`
		SELECT ri.name, COUNT(DISTINCT ri.chain_slug) as chain_count,
			   array_agg(DISTINCT ri.chain_slug) as chains,
			   COUNT(*) as item_count
		FROM retailer_items ri
		LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
		WHERE pl.id IS NULL
		GROUP BY ri.name
		HAVING COUNT(DISTINCT ri.chain_slug) >= 2
		ORDER BY chain_count DESC, item_count DESC
		LIMIT 30
	`);
	console.log(`Found ${crossChain.length} product names appearing in 2+ chains (showing top 30):`);
	for (const row of crossChain) {
		console.log(`  [${row.chain_count} chains] ${row.name} (${row.item_count} items) -> ${row.chains}`);
	}

	// 12. Category distribution on unlinked items
	console.log("\n--- TOP CATEGORIES ON UNLINKED ITEMS ---");
	const catDist = await db.execute(sql`
		SELECT ri.category, ri.chain_slug, COUNT(*) as cnt
		FROM retailer_items ri
		LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
		WHERE pl.id IS NULL AND ri.category IS NOT NULL AND ri.category != ''
		GROUP BY ri.category, ri.chain_slug
		ORDER BY cnt DESC
		LIMIT 40
	`);
	for (const row of catDist) {
		console.log(`  ${String(row.chain_slug).padEnd(12)} ${String(row.category).padEnd(40)} ${String(row.cnt).padStart(6)}`);
	}

	// 13. Products matched across most chains
	console.log("\n--- PRODUCTS MATCHED ACROSS MOST CHAINS ---");
	const multiChain = await db.execute(sql`
		SELECT p.name, p.brand, p.unit, p.unit_quantity,
			   COUNT(DISTINCT ri.chain_slug) as chain_count,
			   array_agg(DISTINCT ri.chain_slug) as chains
		FROM products p
		JOIN product_links pl ON pl.product_id = p.id
		JOIN retailer_items ri ON ri.id = pl.retailer_item_id
		GROUP BY p.id, p.name, p.brand, p.unit, p.unit_quantity
		HAVING COUNT(DISTINCT ri.chain_slug) >= 3
		ORDER BY chain_count DESC
		LIMIT 20
	`);
	console.log(`Products found in 3+ chains (top 20):`);
	for (const row of multiChain) {
		console.log(`  [${row.chain_count} chains] ${row.name} | brand=${row.brand || "?"} | ${row.unit_quantity || "?"}${row.unit || "?"} -> ${row.chains}`);
	}

	// 14. Generic produce/commodity items analysis
	console.log("\n--- GENERIC/COMMODITY ITEMS ANALYSIS ---");
	const genericPatterns = ["voće", "povrće", "meso", "kruh", "mlijeko", "jaja", "sir", "naranč", "jabuk", "banan", "rajčic", "paprik", "krumpir", "luk ", "limun"];
	for (const pattern of genericPatterns) {
		const results = await db.execute(sql`
			SELECT ri.chain_slug, ri.name, ri.brand, ri.unit, ri.unit_quantity
			FROM retailer_items ri
			LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
			WHERE pl.id IS NULL
			AND LOWER(ri.name) LIKE ${`%${pattern}%`}
			LIMIT 5
		`);
		if (results.length > 0) {
			console.log(`\n  Pattern "${pattern}" (${results.length} samples):`);
			for (const r of results) {
				console.log(`    [${r.chain_slug}] ${r.name} | brand=${r.brand || "?"} | ${r.unit_quantity || "?"}${r.unit || "?"}`);
			}
		}
	}

	console.log("\n═══════════════════════════════════════════════════════════════");
	console.log("          ANALYSIS COMPLETE");
	console.log("═══════════════════════════════════════════════════════════════\n");
}

analyzeMatchingGap()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Error:", err);
		process.exit(1);
	});
