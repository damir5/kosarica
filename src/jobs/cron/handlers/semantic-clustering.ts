/**
 * Semantic Clustering Cron Handler
 *
 * Executes the feature + candidate + LLM adjudication + graph clustering pipeline.
 */

import { runSemanticClusteringPipeline } from "@/lib/semantic-clustering";
import { createLogger } from "@/utils/logger";
import type { CronExecutionContext, CronJobHandler } from "../types";

const log = createLogger("matching");

function parsePositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const semanticClusteringHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		const maxBatches = parsePositiveIntEnv(
			"SEMANTIC_CLUSTERING_MAX_BATCHES",
			5,
		);
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

		log.info("Starting scheduled semantic clustering", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			maxBatches,
			featureBatchSize,
			candidateSourceBatch,
			candidateInsertLimit,
			adjudicationBatchSize,
			llmPromptBatchSize,
		});

		let batchesProcessed = 0;
		let featuresUpserted = 0;
		let candidatesQueued = 0;
		let scoringAutoApproved = 0;
		let scoringAutoRejected = 0;
		let scoringPendingReview = 0;
		let pairsAdjudicated = 0;
		let autoApproved = 0;
		let autoRejected = 0;
		let pendingReview = 0;
		let systemErrors = 0;
		let variantClusters = 0;
		let baseClusters = 0;

		for (let i = 0; i < maxBatches; i += 1) {
			const result = await runSemanticClusteringPipeline({
				featureBatchSize,
				candidateSourceBatch,
				candidateInsertLimit,
				adjudicationBatchSize,
				llmPromptBatchSize,
				rebuildClusters: true,
			});
			batchesProcessed += 1;
			featuresUpserted += result.featuresUpserted;
			candidatesQueued += result.candidatesQueued;
			scoringAutoApproved += result.scoringAutoApproved;
			scoringAutoRejected += result.scoringAutoRejected;
			scoringPendingReview += result.scoringPendingReview;
			pairsAdjudicated += result.pairsAdjudicated;
			autoApproved += result.autoApproved;
			autoRejected += result.autoRejected;
			pendingReview += result.pendingReview;
			systemErrors += result.systemErrors;
			variantClusters = result.variantClusters;
			baseClusters = result.baseClusters;

			if (
				result.featuresUpserted === 0 &&
				result.candidatesQueued === 0 &&
				result.pairsAdjudicated === 0
			) {
				break;
			}
		}

		log.info("Scheduled semantic clustering completed", {
			runId: context.runId,
			batchesProcessed,
			featuresUpserted,
			candidatesQueued,
			scoringAutoApproved,
			scoringAutoRejected,
			scoringPendingReview,
			pairsAdjudicated,
			autoApproved,
			autoRejected,
			pendingReview,
			systemErrors,
			variantClusters,
			baseClusters,
		});

		return [];
	},
};
