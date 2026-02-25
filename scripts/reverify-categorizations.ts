import {
	countItemsNeedingReview,
	reverifyItems,
} from "@/lib/categorization/reverify";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
	const modelCount = parsePositiveInt(process.env.REVERIFY_MODEL_COUNT, 3);
	const confidenceThreshold = parseFloatEnv(
		process.env.REVERIFY_CONFIDENCE_THRESHOLD,
		0.8,
	);
	const requireUnanimousForZeroConfidence =
		process.env.REVERIFY_REQUIRE_UNANIMOUS !== "false";
	const maxItems = parsePositiveInt(process.env.REVERIFY_MAX_ITEMS, 100);

	console.log("\n=== Categorization Re-verification ===");
	console.log(`Model count: ${modelCount}`);
	console.log(`Confidence threshold: ${confidenceThreshold}`);
	console.log(`Require unanimous for zero confidence: ${requireUnanimousForZeroConfidence}`);
	console.log(`Max items: ${maxItems}`);

	const before = await countItemsNeedingReview();
	console.log(`\nItems needing review before: ${before}`);

	if (before === 0) {
		console.log("\nNo items need review. Exiting.");
		return;
	}

	console.log("\nStarting re-verification...");
	const result = await reverifyItems(undefined, {
		modelCount,
		confidenceThreshold,
		requireUnanimousForZeroConfidence,
	});

	const after = await countItemsNeedingReview();

	console.log("\n=== Re-verification Summary ===");
	console.log(`Total processed: ${result.totalProcessed}`);
	console.log(`Consensus reached: ${result.consensusReached}`);
	console.log(`Needs human review: ${result.needsHumanReview}`);
	console.log(`Items needing review after: ${after}`);

	if (result.results.length > 0) {
		console.log("\n=== Detailed Results ===");
		for (const r of result.results.slice(0, 20)) {
			console.log(`\nItem: ${r.itemId}`);
			console.log(`  Original: ${r.originalName}`);
			console.log(`  Original confidence: ${r.originalConfidence}`);
			console.log(`  Votes: ${r.votes.length}`);
			console.log(`  Consensus: ${r.consensusType} (${(r.agreementRatio * 100).toFixed(0)}%)`);
			console.log(`  Final confidence: ${r.finalCategorization?.confidence?.toFixed(2) ?? "N/A"}`);
			console.log(`  Needs review: ${r.needsHumanReview}`);
		}

		if (result.results.length > 20) {
			console.log(`\n... and ${result.results.length - 20} more items`);
		}
	}

	const stillNeedReview = result.results.filter((r) => r.needsHumanReview);
	if (stillNeedReview.length > 0) {
		console.log(`\n=== Items Still Needing Human Review ===`);
		console.log(`${stillNeedReview.length} items require manual review.`);
		console.log("Use the admin UI review queue to process these items.");
	}
}

main().catch((error) => {
	log.error("Re-verification failed", { error });
	console.error(error);
	process.exit(1);
});
