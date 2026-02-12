import { runUnifiedMatching } from "@/lib/semantic-clustering/unified-pipeline";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

async function main() {
	log.info("Running unified matching pipeline (8-hour run)...");

	// Estimated capacity: ~8 hours / ~19s per group = ~1,500 groups
	const result = await runUnifiedMatching({
		limit: 1500,
		dryRun: false,
		minPrimaryConfidence: 0.8,
		primaryModelId: "qwen3-4b",
		secondaryModelId: "qwen3-4b",
		blocking: {
			barcodeLimit: 1500,
			barcodeMinChains: 2,
			deterministicLimit: 500,
			embeddingLimit: 500,
			lexicalLimit: 500,
		},
	});

	log.info("Unified matching completed", {
		candidateGroups: result.candidateGroups,
		processedGroups: result.processedGroups,
		skippedGroups: result.skippedGroups,
		escalatedGroups: result.escalatedGroups,
		createdSkus: result.createdSkus,
		linkedItems: result.linkedItems,
		errorGroups: result.errorGroups,
	});
}

main().catch((error) => {
	log.error("Error running unified matching pipeline", { error });
	process.exit(1);
});
