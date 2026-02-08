#!/usr/bin/env tsx
import { sql } from "drizzle-orm";
import { buildBarcodeClusterQueue } from "@/lib/barcode-anchoring";
import { getDb } from "@/utils/bindings";

function hasFlag(flag: string): boolean {
	return process.argv.includes(flag);
}

async function main() {
	const dryRun = hasFlag("--dry-run");
	await buildBarcodeClusterQueue({ limit: 1, minChains: 1 });

	const db = getDb();
	const result = await db.execute(sql`
		SELECT barcode_class, COUNT(*)::int AS count
		FROM retailer_item_barcodes
		GROUP BY barcode_class
		ORDER BY count DESC
	`);
	const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
		barcode_class: string;
		count: number | string;
	}>;

	console.log(`Barcode classification complete (dryRun=${dryRun})`);
	for (const row of rows) {
		console.log(`${row.barcode_class}: ${Number(row.count)}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
