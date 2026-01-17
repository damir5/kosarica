/**
 * Daily Ingestion Worker
 *
 * Bree worker that runs the ingestion pipeline for all configured chains.
 * Executed via cron schedule (6 AM daily) or manual trigger.
 */

import { parentPort } from "node:worker_threads";
import { runIngestionPipeline } from "@/ingestion/processor";
import { createLogger } from "@/utils/logger";

const log = createLogger("daily-ingestion");

async function main(): Promise<void> {
	log.info("Starting daily ingestion job");

	try {
		const results = await runIngestionPipeline();

		const summary = {
			totalChains: results.length,
			successful: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length,
			totalFiles: results.reduce((sum, r) => sum + r.filesProcessed, 0),
			totalEntries: results.reduce((sum, r) => sum + r.entriesPersisted, 0),
		};

		log.info("Daily ingestion completed", summary);

		// Send completion message to parent
		if (parentPort) {
			parentPort.postMessage({
				type: "completed",
				summary,
			});
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.error("Daily ingestion failed", { error: message });

		if (parentPort) {
			parentPort.postMessage({
				type: "error",
				error: message,
			});
		}

		process.exit(1);
	}
}

main().catch((error) => {
	console.error("Unexpected error in daily ingestion worker:", error);
	process.exit(1);
});
