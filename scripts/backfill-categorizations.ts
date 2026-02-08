import { countUncategorizedItems, backfillUncategorizedItems } from "@/lib/categorization";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

function parsePositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
	const batchSize = parsePositiveIntEnv("CATEGORIZATION_BACKFILL_BATCH_SIZE", 1000);
	const maxBatches = parsePositiveIntEnv("CATEGORIZATION_BACKFILL_MAX_BATCHES", 200);
	const chainSlug =
		process.env.CATEGORIZATION_CHAIN_SLUG?.trim().length
			? process.env.CATEGORIZATION_CHAIN_SLUG.trim()
			: undefined;

	console.log("\n=== Categorization Backfill ===");
	console.log(`Batch size: ${batchSize}`);
	console.log(`Max batches: ${maxBatches}`);
	if (chainSlug) {
		console.log(`Chain filter: ${chainSlug}`);
	}

	const before = await countUncategorizedItems();
	console.log(`Uncategorized before: ${before}`);

	const result = await backfillUncategorizedItems({
		batchSize,
		maxBatches,
		chainSlug,
	});

	const after = await countUncategorizedItems();
	console.log("\nBackfill summary:");
	console.log(`Batches processed: ${result.batchesProcessed}`);
	console.log(`Succeeded: ${result.succeeded}`);
	console.log(`Failed: ${result.failed}`);
	console.log(`Escalated: ${result.escalated}`);
	console.log(`Uncategorized after: ${after}`);
}

main().catch((error) => {
	log.error("Categorization backfill failed", { error });
	console.error(error);
	process.exit(1);
});
