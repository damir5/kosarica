#!/usr/bin/env tsx
import {
	detectCatalogConflicts,
	summarizeCatalogConflicts,
} from "@/lib/catalog-validation";

async function main() {
	const conflicts = await detectCatalogConflicts();
	const summary = summarizeCatalogConflicts(conflicts);

	console.log("Catalog conflict summary:");
	console.log(JSON.stringify(summary, null, 2));

	if (conflicts.length > 0) {
		console.log("Sample conflicts:");
		console.log(JSON.stringify(conflicts.slice(0, 20), null, 2));
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
