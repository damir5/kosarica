#!/usr/bin/env tsx
import { autoLinkCommodityItems } from "@/lib/catalog/commodity-linking";
import { indexCanonicalSkusBatch, indexRetailerItemsBatch } from "@/lib/search";

function getArg(name: string): string | null {
	const index = process.argv.findIndex((arg) => arg === name);
	if (index < 0 || index + 1 >= process.argv.length) {
		return null;
	}
	return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string): boolean {
	return process.argv.includes(flag);
}

async function main() {
	const dryRun = hasFlag("--dry-run");

	if (dryRun) {
		console.log(
			"Commodity auto-link dry-run is not supported. Run without --dry-run to mutate the catalog.",
		);
		process.exit(1);
	}

	if (getArg("--limit")) {
		throw new Error("--limit is not implemented for commodity auto-linking");
	}

	const result = await autoLinkCommodityItems();
	await indexCanonicalSkusBatch(result.affectedSkuIds);
	await indexRetailerItemsBatch(result.linkedRetailerItemIds);

	console.log("Commodity auto-link run complete");
	console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
