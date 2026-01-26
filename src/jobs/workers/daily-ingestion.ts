/**
 * Daily Ingestion Worker
 *
 * Bree worker that triggers ingestion for all configured chains via the Go service.
 * The Go service handles the actual ingestion asynchronously.
 * Executed via cron schedule (6 AM daily) or manual trigger.
 */

import { parentPort } from "node:worker_threads";
import { goFetch } from "@/lib/go-service-client";
import { createLogger } from "@/utils/logger";

const log = createLogger("daily-ingestion");

async function main(): Promise<void> {
	log.info("Starting daily ingestion job");

	// Fetch chains dynamically from Go service
	let chains: string[];
	try {
		const response = await goFetch("/internal/chains");
		if (!response.success) {
			throw new Error(response.error || "Failed to fetch chains");
		}
		const data = response.data as { chains: string[] };
		chains = data.chains;
		log.info(`Fetched ${chains.length} chains from Go service`);
	} catch (error) {
		log.error("Failed to fetch chains from Go service", { error });
		throw error;
	}

	let successful = 0;
	let failed = 0;

	for (const chain of chains) {
		try {
			log.info(`Triggering ingestion for chain: ${chain}`);

			// Trigger ingestion via Go service (returns 202 immediately)
			const response = await goFetch(`/internal/admin/ingest/${chain}`, {
				method: "POST",
			});

			if (!response.success) {
				throw new Error(response.error || "Failed to trigger ingestion");
			}

			const result = response.data as {
				runId: string;
				status: string;
				pollUrl: string;
			};

			log.info(`Ingestion triggered for ${chain}`, {
				runId: result.runId,
				status: result.status,
			});

			successful++;

			// Add 1 second delay between chains to avoid overwhelming the service
			if (chain !== chains[chains.length - 1]) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Failed to trigger ingestion for ${chain}`, { error: message });
			failed++;
		}
	}

	const summary = {
		totalChains: chains.length,
		successful,
		failed,
	};

	log.info("Daily ingestion triggers completed", summary);

	// Send completion message to parent
	if (parentPort) {
		parentPort.postMessage({
			type: "completed",
			summary,
		});
	}
}

main().catch((error) => {
	console.error("Unexpected error in daily ingestion worker:", error);
	process.exit(1);
});
