#!/usr/bin/env tsx
import { processBarcodeClusters } from "@/lib/barcode-anchoring";

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
	const minChainsRaw = getArg("--min-chains");
	const minChains = minChainsRaw ? Number.parseInt(minChainsRaw, 10) : 2;
	const limitRaw = getArg("--limit");
	const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
	const dryRun = hasFlag("--dry-run");

	const result = await processBarcodeClusters({
		minChains: Number.isFinite(minChains) && minChains > 0 ? minChains : 2,
		limit: Number.isFinite(limit) && (limit ?? 0) > 0 ? limit : undefined,
		dryRun,
	});

	console.log("Barcode auto-link run complete");
	console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
