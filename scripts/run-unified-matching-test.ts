import { runUnifiedMatching } from "@/lib/semantic-clustering/unified-pipeline";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

async function main() {
	log.info("Running unified matching pipeline (small sample test)...");
	const startTime = Date.now();

	console.log("\n=== Running Unified Matching Pipeline ===\n");

	const result = await runUnifiedMatching({
		limit: 10,
		dryRun: false,
		minPrimaryConfidence: 0.8,
		primaryModelId: "qwen3-4b",
		secondaryModelId: "qwen3-4b",
		blocking: {
			barcodeLimit: 10,
			barcodeMinChains: 2,
			deterministicLimit: 5,
			embeddingLimit: 5,
			lexicalLimit: 5,
		},
	});

	const duration = Date.now() - startTime;
	console.log("\n=== Unified Matching Results (Sample Test) ===");
	console.log(`Candidate groups generated: ${result.candidateGroups}`);
	console.log(`Groups processed: ${result.processedGroups}`);
	console.log(`Groups skipped (singletons): ${result.skippedGroups}`);
	console.log(`Groups escalated to secondary model: ${result.escalatedGroups}`);
	console.log(`Canonical SKUs created: ${result.createdSkus}`);
	console.log(`Items linked to SKUs: ${result.linkedItems}`);
	console.log(`Groups with errors: ${result.errorGroups}`);
	console.log("\n--- Blocking Statistics ---");
	console.log(`Barcode groups: ${result.blockingStats.barcodeGroups}`);
	console.log(`Deterministic groups: ${result.blockingStats.deterministicGroups}`);
	console.log(`Embedding groups: ${result.blockingStats.embeddingGroups}`);
	console.log(`Lexical groups: ${result.blockingStats.lexicalGroups}`);
	console.log(`Total unique items: ${result.blockingStats.totalItems}`);
	console.log(`Duration: ${duration}ms`);
	console.log("=============================================\n");
}

main().catch((error) => {
	console.error("Error running unified matching pipeline");
	console.error(error);
	process.exit(1);
});
