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
					('lidl', 'Lidl', 'https://www.lidl.hr', NULL, NOW()),
					('plodine', 'Plodine', 'https://www.plodine.hr', NULL, NOW()),
					('interspar', 'Interspar', 'https://www.interspar.hr', NULL, NOW()),
					('studenac', 'Studenac', 'https://www.studenac.hr', NULL, NOW()),
					('kaufland', 'Kaufland', 'https://www.kaufland.hr', NULL, NOW()),
					('eurospin', 'Eurospin', 'https://www.eurospin.hr', NULL, NOW()),
					('dm', 'dm', 'https://www.dm.hr', NULL, NOW()),
					('ktc', 'KTC', 'https://www.ktc.hr', NULL, NOW()),
					('metro', 'Metro', 'https://www.metro.hr', NULL, NOW()),
					('trgocentar', 'Trgocentar', 'https://www.trgocentar.hr', NULL, NOW())
				ON CONFLICT (slug) DO NOTHING
			`,
		);
		console.log("   ✓ Chains inserted (11 chains)");

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

		// Insert price tiers for the retailer items
		await db.execute(
			sql`
				INSERT INTO price_tiers (
					id, chain_slug, retailer_item_id, price, discount_price, unit_price,
					target_date, first_seen_at, last_seen_at, store_count, created_at
				)
				VALUES
					('pt_seed_001', 'konzum', 'rit987654321', 1295, NULL, 1295, CURRENT_DATE, NOW(), NOW(), 2, NOW()),
					('pt_seed_002', 'konzum', 'rit987654322', 1495, 1295, 1495, CURRENT_DATE, NOW(), NOW(), 1, NOW()),
					('pt_seed_003', 'dm', 'rit987654323', 1895, NULL, 1895, CURRENT_DATE, NOW(), NOW(), 1, NOW())
				ON CONFLICT (id) DO NOTHING
			`,
		);
		console.log("   ✓ Price tiers inserted (3 tiers)");

		// Insert store price references
		await db.execute(
			sql`
				INSERT INTO store_price_refs (store_id, retailer_item_id, price_tier_id, in_stock, target_date, last_seen_at)
				VALUES
					('sto123456789', 'rit987654321', 'pt_seed_001', true, CURRENT_DATE, NOW()),
					('sto123456789', 'rit987654322', 'pt_seed_002', true, CURRENT_DATE, NOW()),
					('sto234567890', 'rit987654321', 'pt_seed_001', true, CURRENT_DATE, NOW()),
					('sto345678901', 'rit987654323', 'pt_seed_003', true, CURRENT_DATE, NOW())
				ON CONFLICT DO NOTHING
			`,
		);
		console.log("   ✓ Store price refs inserted (4 entries)");

		console.log("\n5. Verifying data...");
		const chainsResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM chains`,
		);
		const chainsCount = chainsResult[0]?.count ?? 0;
		console.log(`   Chains: ${chainsCount} rows`);

		const storesResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM stores`,
		);
		const storesCount = storesResult[0]?.count ?? 0;
		console.log(`   Stores: ${storesCount} rows`);

		const itemsResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM retailer_items WHERE name ILIKE '%milk%'`,
		);
		const itemsCount = itemsResult[0]?.count ?? 0;
		console.log(`   Retailer items (milk): ${itemsCount} rows`);

		const priceTiersResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM price_tiers`,
		);
		const priceTiersCount = priceTiersResult[0]?.count ?? 0;
		console.log(`   Price tiers: ${priceTiersCount} rows`);

		const storeRefsResult = await db.execute(
			sql`SELECT COUNT(*) as count FROM store_price_refs`,
		);
		const storeRefsCount = storeRefsResult[0]?.count ?? 0;
		console.log(`   Store price refs: ${storeRefsCount} rows`);

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
