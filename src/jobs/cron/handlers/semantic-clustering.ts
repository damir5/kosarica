/**
 * Semantic Clustering Cron Handler
 *
 * Enqueues clustering work into the task queue.
 */

import { createLogger } from "@/utils/logger";
import type {
	CronExecutionContext,
	CronJobHandler,
	TaskToEnqueue,
} from "../types";

const log = createLogger("matching");

function parsePositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseConfidenceEnv(name: string): number | undefined {
	const raw = process.env[name];
	if (!raw) return undefined;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
		? parsed
		: undefined;
}

export const semanticClusteringHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<TaskToEnqueue[]> {
		const mode = process.env.SEMANTIC_CLUSTERING_MODE ?? "pairwise";

		if (mode === "unified") {
			const limit = parsePositiveIntEnv("UNIFIED_MATCHING_LIMIT", 50);
			const minPrimaryConfidence = parseConfidenceEnv(
				"LISTWISE_MIN_PRIMARY_CONFIDENCE",
			);

			log.info("Queueing scheduled semantic clustering (unified)", {
				runId: context.runId,
				scheduledFor: context.scheduledFor.toISOString(),
				limit,
				dryRun: process.env.UNIFIED_MATCHING_DRY_RUN === "1",
			});

			return [
				{
					type: "matching",
					payload: {
						type: "semanticClusteringUnified",
						limit,
						dryRun: process.env.UNIFIED_MATCHING_DRY_RUN === "1",
						minPrimaryConfidence,
						primaryModelId: process.env.LISTWISE_PRIMARY_MODEL_ID,
						secondaryModelId: process.env.LISTWISE_SECONDARY_MODEL_ID,
					},
					idempotencyKey: `semantic-clustering:unified:${context.scheduledFor.toISOString()}`,
				},
			];
		}

		if (mode === "listwise") {
			const limit = parsePositiveIntEnv("LISTWISE_CLUSTER_LIMIT", 25);
			const minChains = parsePositiveIntEnv("LISTWISE_MIN_CHAINS", 2);
			const minPrimaryConfidence = parseConfidenceEnv(
				"LISTWISE_MIN_PRIMARY_CONFIDENCE",
			);

			log.info("Queueing scheduled semantic clustering (listwise)", {
				runId: context.runId,
				scheduledFor: context.scheduledFor.toISOString(),
				limit,
				minChains,
				primaryModelId: process.env.LISTWISE_PRIMARY_MODEL_ID ?? "qwen",
				secondaryModelId:
					process.env.LISTWISE_SECONDARY_MODEL_ID ?? "ministral",
				minPrimaryConfidence,
				dryRun: process.env.LISTWISE_DRY_RUN === "1",
			});

			return [
				{
					type: "matching",
					payload: {
						type: "semanticClusteringListwise",
						limit,
						minChains,
						dryRun: process.env.LISTWISE_DRY_RUN === "1",
						minPrimaryConfidence,
						primaryModelId: process.env.LISTWISE_PRIMARY_MODEL_ID,
						secondaryModelId: process.env.LISTWISE_SECONDARY_MODEL_ID,
					},
					idempotencyKey: `semantic-clustering:listwise:${context.scheduledFor.toISOString()}`,
				},
			];
		}

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
		const embeddingBackfillBatchSize = parsePositiveIntEnv(
			"SEMANTIC_CLUSTERING_EMBEDDING_BACKFILL_BATCH_SIZE",
			2000,
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

		log.info("Queueing scheduled semantic clustering (pairwise)", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			maxBatches,
			featureBatchSize,
			embeddingBackfillBatchSize,
			candidateSourceBatch,
			candidateInsertLimit,
			adjudicationBatchSize,
			llmPromptBatchSize,
		});

		return [
			{
				type: "matching",
				payload: {
					type: "semanticClusteringPairwise",
					maxBatches,
					featureBatchSize,
					embeddingBackfillBatchSize,
					candidateSourceBatch,
					candidateInsertLimit,
					adjudicationBatchSize,
					llmPromptBatchSize,
					rebuildClusters: true,
				},
				idempotencyKey: `semantic-clustering:pairwise:${context.scheduledFor.toISOString()}`,
			},
		];
	},
};
