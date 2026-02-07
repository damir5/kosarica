import { runSemanticClusteringPipeline } from "@/lib/semantic-clustering";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

async function main() {
	log.info("Running semantic clustering pipeline...");
	const startTime = Date.now();

	const result = await runSemanticClusteringPipeline({
		featureBatchSize: 2000,
		candidateSourceBatch: 1000,
		candidateInsertLimit: 5000,
		adjudicationBatchSize: 200,
		rebuildClusters: true,
	});

	const duration = Date.now() - startTime;
	console.log("\n=== Semantic Clustering Results ===");
	console.log(`Features upserted: ${result.featuresUpserted}`);
	console.log(`Candidates queued: ${result.candidatesQueued}`);
	console.log(`Pairs adjudicated: ${result.pairsAdjudicated}`);
	console.log(`Auto-approved: ${result.autoApproved}`);
	console.log(`Auto-rejected: ${result.autoRejected}`);
	console.log(`Pending review: ${result.pendingReview}`);
	console.log(`System errors: ${result.systemErrors}`);
	console.log(`Variant clusters: ${result.variantClusters}`);
	console.log(`Base clusters: ${result.baseClusters}`);
	console.log(`Duration: ${duration}ms`);
	console.log("===================================\n");
}

main().catch((error) => {
	log.error("Error running semantic clustering pipeline", { error });
	process.exit(1);
});
