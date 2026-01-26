import "dotenv/config";
import { getDatabase } from "../src/db/index";
import { sql } from "drizzle-orm";

async function seedTestData() {
	const db = getDatabase();
	console.log("Seeding test data...");

	try {
		await db.execute(
			sql`
				INSERT INTO chains (slug, name, website, logo_url, created_at)
				VALUES
					('konzum', 'Konzum', 'https://www.konzum.hr', NULL, NOW()),
					('dm', 'dm', 'https://www.dm.hr', NULL, NOW())
				ON CONFLICT (slug) DO NOTHING
			`,
		);
		console.log("   ✓ Chains inserted (konzum, dm)");

		await db.execute(
			sql`
				INSERT INTO stores (id, chain_slug, name, address, city, postal_code, is_virtual, status, created_at, updated_at)
				VALUES
					('sto123456789', 'konzum', 'Konzum Centar', 'Ilica 1', 'Zagreb', '10000', false, 'active', NOW(), NOW()),
					('sto234567890', 'konzum', 'Konzum Mall', 'Avenija M. Czernia 1', 'Zagreb', '10000', false, 'active', NOW(), NOW()),
					('sto345678901', 'dm', 'dm Drogerie Centar', 'Trg Bana Jelačića 1', 'Zagreb', '10000', false, 'active', NOW(), NOW())
				ON CONFLICT (id) DO NOTHING
			`,
		);
		console.log("   ✓ Stores inserted (2 konzum, 1 dm)");

		await db.execute(
			sql`
				INSERT INTO retailer_items (
					id, retailer_item_id, barcode, name, external_id, brand, category, subcategory,
					unit, unit_quantity, image_url, chain_slug, is_primary, created_at
				)
				VALUES
					('rit987654321', 1001, '3850000000123', 'Milk', 'KONZUM-1001', 'Konzum', 'Dairy', 'Milk',
					 'L', '1', NULL, 'konzum', true, NOW()),
					('rit987654322', 1002, '3850000000124', 'Chocolate Milk', 'KONZUM-1002', 'Konzum', 'Dairy', 'Flavored Milk',
					 'L', '1', NULL, 'konzum', true, NOW()),
					('rit987654323', 1003, '3850000000125', 'Organic Milk', 'DM-1001', 'dm', 'Dairy', 'Organic',
					 'L', '1', NULL, 'dm', true, NOW())
				ON CONFLICT (id) DO NOTHING
			`,
		);
		console.log("   ✓ Retailer items inserted (3 items with 'milk' in name)");

		await db.execute(
			sql`
				INSERT INTO store_item_state (
					store_id, retailer_item_id, current_price, previous_price, discount_price,
					discount_start, discount_end, in_stock, unit_price, unit_price_base_quantity,
					unit_price_base_unit, lowest_price_30d, anchor_price, anchor_price_as_of,
					price_signature, last_seen_at, updated_at
				)
				VALUES
					('sto123456789', 'rit987654321', 1295, 1195, NULL, NULL, NULL, true, 1295, '1', 'L', 1195, 1295, NOW(), 'sig1', NOW(), NOW()),
					('sto123456789', 'rit987654322', 1495, 1395, 1295, NOW(), NOW() + INTERVAL '7 days', true, 1495, '1', 'L', 1395, 1495, NOW(), 'sig2', NOW(), NOW()),
					('sto234567890', 'rit987654321', 1295, 1295, NULL, NULL, NULL, true, 1295, '1', 'L', 1195, 1295, NOW(), 'sig3', NOW(), NOW()),
					('sto345678901', 'rit987654323', 1895, 1795, NULL, NULL, NULL, true, 1895, '1', 'L', 1795, 1895, NOW(), 'sig4', NOW(), NOW())
				ON CONFLICT DO NOTHING
			`,
		);
		console.log("   ✓ Store item state entries inserted (4 entries)");

		console.log("\n5. Verifying data...");
		const chainsResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM chains WHERE slug IN ('konzum', 'dm')`,
		);
		const chainsCount = chainsResult[0]?.count ?? 0;
		console.log(`   Chains: ${chainsCount} rows`);

		const storesResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM stores WHERE chain_slug IN ('konzum', 'dm')`,
		);
		const storesCount = storesResult[0]?.count ?? 0;
		console.log(`   Stores: ${storesCount} rows`);

		const itemsResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM retailer_items WHERE name ILIKE '%milk%'`,
		);
		const itemsCount = itemsResult[0]?.count ?? 0;
		console.log(`   Retailer items (milk): ${itemsCount} rows`);

		const stateResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM store_item_state sis
				JOIN retailer_items ri ON sis.retailer_item_id = ri.id
				WHERE ri.name ILIKE '%milk%'`,
		);
		const stateCount = stateResult[0]?.count ?? 0;
		console.log(`   Store item state: ${stateCount} rows`);

		console.log("\n✅ Test data seeded successfully!");
	} catch (error) {
		console.error("\n❌ Error seeding test data:", error);
		throw error;
	} finally {
		
	}
}

seedTestData()
	.then(() => {
		console.log("\nDone!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("\nFatal error:", error);
		process.exit(1);
	});
