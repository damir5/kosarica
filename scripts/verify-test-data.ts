import "dotenv/config";
import { getDatabase } from "../src/db/index.js";
import { sql } from "drizzle-orm";

async function verifyTestData() {
	const db = getDatabase();

	console.log("=== VERIFIED TEST DATA ===\n");

	console.log("1. Chains:");
	const chains = await db.execute(
		sql`SELECT slug, name FROM chains WHERE slug IN ('konzum', 'dm')`,
	);
	chains.forEach((row) => console.log(`   - ${row.slug}: ${row.name}`));

	console.log("\n2. Stores:");
	const stores = await db.execute(
		sql`SELECT id, chain_slug, name FROM stores WHERE chain_slug IN ('konzum', 'dm')`,
	);
	stores.forEach((row) => console.log(`   - ${row.id}: ${row.chain_slug} - ${row.name}`));

	console.log("\n3. Retailer Items (milk):");
	const items = await db.execute(
		sql`SELECT id, name, brand, category, chain_slug, barcode FROM retailer_items WHERE name ILIKE '%milk%'`,
	);
	items.forEach((row) => console.log(`   - ${row.name} (${row.brand}) - ${row.barcode} - ${row.chain_slug}`));

	console.log("\n4. Store Item State (sample):");
	const states = await db.execute(
		sql`SELECT sis.id, s.name as store, ri.name as item, sis.current_price
			FROM store_item_state sis
			JOIN stores s ON sis.store_id = s.id
			JOIN retailer_items ri ON sis.retailer_item_id = ri.id
			WHERE ri.name ILIKE '%milk%'
			LIMIT 5`,
	);
	states.forEach((row) => console.log(`   - ${row.store} - ${row.item}: ${row.current_price} lipa`));

	console.log("\n=== END VERIFICATION ===");
}

verifyTestData().catch(console.error);
