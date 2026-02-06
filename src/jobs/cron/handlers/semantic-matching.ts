/**
 * Semantic Matching Cron Handler
 *
 * Automatically links unmatched retailer items to products using
 * BGE-M3 vector embeddings and pgvector nearest-neighbor search.
 */

import { runSemanticMatching } from "@/lib/matching";
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

export const semanticMatchingHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		const batchSize = parsePositiveIntEnv("SEMANTIC_MATCHING_BATCH_SIZE", 100);
		const maxBatches = parsePositiveIntEnv("SEMANTIC_MATCHING_MAX_BATCHES", 20);

		log.info("Starting scheduled semantic matching", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			batchSize,
			maxBatches,
		});

		let batchesProcessed = 0;
		let totalProcessed = 0;
		let totalHighConfidence = 0;
		let totalQueuedForReview = 0;
		let totalNoMatch = 0;
		let totalEmbeddingsComputed = 0;
		let totalEmbeddingFailures = 0;

		for (let i = 0; i < maxBatches; i += 1) {
			const result = await runSemanticMatching({ batchSize });
			batchesProcessed += 1;
			totalProcessed += result.processed;
			totalHighConfidence += result.highConfidence;
			totalQueuedForReview += result.queuedForReview;
			totalNoMatch += result.noMatch;
			totalEmbeddingsComputed += result.embeddingsComputed;
			totalEmbeddingFailures += result.embeddingFailures;

			const progress = result.processed + result.noMatch;
			if (progress === 0) {
				break;
			}
		}

		log.info("Scheduled semantic matching completed", {
			runId: context.runId,
			batchesProcessed,
			totalProcessed,
			totalHighConfidence,
			totalQueuedForReview,
			totalNoMatch,
			totalEmbeddingsComputed,
			totalEmbeddingFailures,
		});

		return [];
	},
};
