/**
 * Trigram Matching Cron Handler
 *
 * Automatically links unmatched retailer items to products using
 * PostgreSQL trigram similarity search.
 */

import { runTrigramMatching } from "@/lib/matching";
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

export const trigramMatchingHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		const batchSize = parsePositiveIntEnv("TRIGRAM_MATCHING_BATCH_SIZE", 200);
		const maxBatches = parsePositiveIntEnv("TRIGRAM_MATCHING_MAX_BATCHES", 20);

		log.info("Starting scheduled trigram matching", {
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

		for (let i = 0; i < maxBatches; i += 1) {
			const result = await runTrigramMatching({ batchSize });
			batchesProcessed += 1;
			totalProcessed += result.processed;
			totalHighConfidence += result.highConfidence;
			totalQueuedForReview += result.queuedForReview;
			totalNoMatch += result.noMatch;

			const progress = result.processed + result.noMatch;
			if (progress === 0) {
				break;
			}
		}

		log.info("Scheduled trigram matching completed", {
			runId: context.runId,
			batchesProcessed,
			totalProcessed,
			totalHighConfidence,
			totalQueuedForReview,
			totalNoMatch,
		});

		return [];
	},
};
