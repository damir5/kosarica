#!/usr/bin/env tsx
import { and, eq, isNull } from "drizzle-orm";
import { retailerItemFeatures, retailerItems, skuItemLinks } from "@/db/schema";
import { generateCandidates } from "@/lib/feature-matching";
import { getDb } from "@/utils/bindings";

function getArg(name: string): string | null {
	const index = process.argv.findIndex((arg) => arg === name);
	if (index < 0 || index + 1 >= process.argv.length) {
		return null;
	}
	return process.argv[index + 1] ?? null;
}

async function main() {
	const category = getArg("--category");
	const limitRaw = getArg("--limit");
	const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;

	const db = getDb();
	const rows = await db
		.select({
			retailerItemId: retailerItems.id,
		})
		.from(retailerItems)
		.innerJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.leftJoin(
			skuItemLinks,
			eq(skuItemLinks.retailerItemId, retailerItems.id),
		)
		.where(
			and(
				isNull(retailerItems.mergedIntoId),
				isNull(skuItemLinks.retailerItemId),
				...(category
					? [eq(retailerItemFeatures.normalizedCategory, category)]
					: []),
			),
		)
		.limit(Number.isFinite(limit) && limit > 0 ? limit : 50);

	const summary = [];
	for (const row of rows) {
		const candidates = await generateCandidates({
			sourceItemId: row.retailerItemId,
			limit: 10,
			minScore: 0.5,
		});
		summary.push({
			itemId: row.retailerItemId,
			candidateCount: candidates.length,
			topScore: candidates[0]?.score ?? 0,
		});
	}

	console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
