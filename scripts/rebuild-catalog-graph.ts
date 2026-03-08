import { isNull } from "drizzle-orm";
import { getDatabase, retailerItems } from "@/db";
import { syncCatalogGraphForItems } from "@/lib/catalog/graph-sync";
import { chunk } from "@/lib/collections/chunk";

async function main() {
	const db = getDatabase();
	const rows = await db
		.select({ id: retailerItems.id })
		.from(retailerItems)
		.where(isNull(retailerItems.mergedIntoId));

	let processed = 0;
	for (const group of chunk(
		rows.map((row) => row.id),
		250,
	)) {
		await syncCatalogGraphForItems(group);
		processed += group.length;
		console.log(`catalog graph synced: ${processed}/${rows.length}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

