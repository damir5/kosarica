/**
 * Barcode Matching Cron Handler
 *
 * Automatically links unmatched retailer items to products by barcode.
 */

import { runBarcodeMatching } from "@/lib/matching";
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

export const barcodeMatchingHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		const batchSize = parsePositiveIntEnv("BARCODE_MATCHING_BATCH_SIZE", 1000);
		const maxBatches = parsePositiveIntEnv("BARCODE_MATCHING_MAX_BATCHES", 20);

		log.info("Starting scheduled barcode matching", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			batchSize,
			maxBatches,
		});

		let batchesProcessed = 0;
		let newProducts = 0;
		let newLinks = 0;
		let suspiciousFlags = 0;
		let skipped = 0;

		for (let i = 0; i < maxBatches; i += 1) {
			const result = await runBarcodeMatching({ batchSize });
			batchesProcessed += 1;
			newProducts += result.newProducts;
			newLinks += result.newLinks;
			suspiciousFlags += result.suspiciousFlags;
			skipped += result.skipped;

			const progress =
				result.newProducts + result.newLinks + result.suspiciousFlags;
			if (progress === 0) {
				break;
			}
		}

		log.info("Scheduled barcode matching completed", {
			runId: context.runId,
			batchesProcessed,
			newProducts,
			newLinks,
			suspiciousFlags,
			skipped,
		});

		return [];
	},
};
