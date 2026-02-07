import { runSemanticClusteringPipeline } from "@/lib/semantic-clustering";
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
	const featureBatchSize = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_FEATURE_BATCH_SIZE",
		2000,
	);
	const candidateSourceBatch = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_CANDIDATE_SOURCE_BATCH",
		1000,
	);
	const candidateInsertLimit = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_CANDIDATE_INSERT_LIMIT",
		5000,
	);
	const adjudicationBatchSize = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_ADJUDICATION_BATCH_SIZE",
		200,
	);
	const llmPromptBatchSize = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_LLM_PROMPT_BATCH_SIZE",
		25,
	);

	const result = await runSemanticClusteringPipeline({
		featureBatchSize,
		candidateSourceBatch,
		candidateInsertLimit,
		adjudicationBatchSize,
		llmPromptBatchSize,
		rebuildClusters: true,
	});

	console.log("\n=== Semantic Clustering Pipeline ===");
	console.log(`Features upserted: ${result.featuresUpserted}`);
	console.log(`Candidates queued: ${result.candidatesQueued}`);
	console.log(`Scoring auto-approved: ${result.scoringAutoApproved}`);
	console.log(`Scoring auto-rejected: ${result.scoringAutoRejected}`);
	console.log(`Scoring pending review: ${result.scoringPendingReview}`);
	console.log(`Pairs adjudicated: ${result.pairsAdjudicated}`);
	console.log(`Auto-approved: ${result.autoApproved}`);
	console.log(`Auto-rejected: ${result.autoRejected}`);
	console.log(`Pending review: ${result.pendingReview}`);
	console.log(`System errors: ${result.systemErrors}`);
	console.log(`Variant clusters: ${result.variantClusters}`);
	console.log(`Base clusters: ${result.baseClusters}`);
	console.log("====================================\n");
}

main().catch((error) => {
	log.error("Semantic clustering pipeline failed", { error });
	console.error(error);
	process.exit(1);
});
