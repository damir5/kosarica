import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { runSemanticClusteringPipeline } from "@/lib/semantic-clustering";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

function parsePositiveIntArg(argv: string[], flag: string, fallback: number): number {
	const index = argv.indexOf(flag);
	if (index === -1) {
		return fallback;
	}
	const raw = argv[index + 1];
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolFlag(argv: string[], flag: string): boolean {
	return argv.includes(flag);
}

function loadRuntimeEnv(): void {
	if (process.env.DATABASE_URL) {
		return;
	}

	const envCandidates: string[] = [];
	if (process.env.NODE_ENV) {
		envCandidates.push(`.env.${process.env.NODE_ENV}`);
	}
	envCandidates.push(".env.test", ".env.development", ".env");

	for (const file of envCandidates) {
		if (!existsSync(file)) {
			continue;
		}
		loadDotenv({ path: file });
		if (process.env.DATABASE_URL) {
			return;
		}
	}
}

async function main() {
	loadRuntimeEnv();
	const argv = process.argv.slice(2);

	if (parseBoolFlag(argv, "--dry-run")) {
		console.log(
			"Knowledge apply dry-run is deprecated after legacy matcher removal; no mutations were applied.",
		);
		return;
	}

	const featureBatchSize = parsePositiveIntArg(argv, "--feature-batch-size", 2000);
	const candidateSourceBatch = parsePositiveIntArg(
		argv,
		"--candidate-source-batch",
		1000,
	);
	const embeddingBackfillBatchSize = parsePositiveIntArg(
		argv,
		"--embedding-backfill-batch-size",
		2000,
	);
	const candidateInsertLimit = parsePositiveIntArg(
		argv,
		"--candidate-insert-limit",
		5000,
	);
	const adjudicationBatchSize = parsePositiveIntArg(
		argv,
		"--adjudication-batch-size",
		200,
	);
	const llmPromptBatchSize = parsePositiveIntArg(
		argv,
		"--llm-prompt-batch-size",
		25,
	);
	const rebuildClusters = !parseBoolFlag(argv, "--no-rebuild-clusters");

	const result = await runSemanticClusteringPipeline({
		featureBatchSize,
		embeddingBackfillBatchSize,
		candidateSourceBatch,
		candidateInsertLimit,
		adjudicationBatchSize,
		llmPromptBatchSize,
		rebuildClusters,
	});

	console.log("Knowledge apply summary:");
	console.log(`Features upserted: ${result.featuresUpserted}`);
	console.log(`Feature embeddings upserted: ${result.featureEmbeddingsUpserted}`);
	console.log(`Embeddings backfilled: ${result.embeddingsBackfilled}`);
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
}

main().catch((error) => {
	log.error("Knowledge apply failed", { error });
	console.error(error);
	process.exit(1);
});
