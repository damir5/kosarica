/**
 * Knowledge Matching Cron Handler
 *
 * Links unmatched retailer items using the knowledge catalog.
 */

import { runKnowledgeMatching } from "@/lib/matching";
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

export const knowledgeMatchingHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		const batchSize = parsePositiveIntEnv("KNOWLEDGE_MATCHING_BATCH_SIZE", 250);
		const maxBatches = parsePositiveIntEnv("KNOWLEDGE_MATCHING_MAX_BATCHES", 20);

		log.info("Starting scheduled knowledge matching", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			batchSize,
			maxBatches,
		});

		let batchesProcessed = 0;
		let processed = 0;
		let matchedByCanonicalKey = 0;
		let matchedByEquivalence = 0;
		let newLinks = 0;
		let createdProducts = 0;
		let aliasesAdded = 0;
		let noMatch = 0;

		for (let i = 0; i < maxBatches; i += 1) {
			const result = await runKnowledgeMatching({ batchSize });
			batchesProcessed += 1;
			processed += result.processed;
			matchedByCanonicalKey += result.matchedByCanonicalKey;
			matchedByEquivalence += result.matchedByEquivalence;
			newLinks += result.newLinks;
			createdProducts += result.createdProducts;
			aliasesAdded += result.aliasesAdded;
			noMatch += result.noMatch;

			if (result.processed === 0 || result.newLinks === 0) {
				break;
			}
		}

		log.info("Scheduled knowledge matching completed", {
			runId: context.runId,
			batchesProcessed,
			processed,
			matchedByCanonicalKey,
			matchedByEquivalence,
			newLinks,
			createdProducts,
			aliasesAdded,
			noMatch,
		});

		return [];
	},
};
