/**
 * Daily Ingestion Worker
 *
 * Triggers ingestion for all configured chains via the Go service.
 * The Go service handles the actual ingestion asynchronously.
 * Can be called via cron schedule (6 AM daily) or manual trigger.
 */

import { goFetchWithRetry } from "@/lib/go-service-client";
import { createLogger } from "@/utils/logger";

const log = createLogger("daily-ingestion");

export interface DailyIngestionResult {
	totalChains: number;
	successful: number;
	failed: number;
}

/**
 * Process an array of items with limited concurrency
 * Similar to p-limit but implemented natively
 */
async function asyncPool<T, R>(
	concurrency: number,
	items: T[],
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	const executing: Set<Promise<void>> = new Set();

	for (let i = 0; i < items.length; i++) {
		const wrappedPromise = fn(items[i])
			.then((result) => {
				results[i] = result;
			})
			.finally(() => {
				executing.delete(wrappedPromise);
			});

		executing.add(wrappedPromise);

		if (executing.size >= concurrency) {
			await Promise.race(executing);
		}
	}

	await Promise.all(executing);
	return results;
}

/**
 * Trigger ingestion for a single chain with timeout and retry
 */
async function triggerChainIngestion(chain: string): Promise<boolean> {
	try {
		log.info(`Triggering ingestion for chain: ${chain}`);

		// Trigger ingestion via Go service with 30s timeout and retry
		const response = await goFetchWithRetry(`/internal/admin/ingest/${chain}`, {
			method: "POST",
			timeout: 30000, // 30 seconds
			maxRetries: 2,
			retryDelay: 1000,
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

		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.error(`Failed to trigger ingestion for ${chain}`, { error: message });
		return false;
	}
}

/**
 * Run daily ingestion for all chains.
 * Fetches chain list from Go service and triggers ingestion for each.
 * Processes chains in parallel with limited concurrency for better performance.
 */
export async function runDailyIngestion(): Promise<DailyIngestionResult> {
	log.info("Starting daily ingestion job");

	// Fetch chains dynamically from Go service with timeout
	let chains: string[];
	try {
		const response = await goFetchWithRetry("/internal/chains", {
			timeout: 10000, // 10 seconds
			maxRetries: 2,
		});

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

	// Process chains in parallel with limited concurrency (5 concurrent)
	const CONCURRENCY_LIMIT = 5;
	const results = await asyncPool(
		CONCURRENCY_LIMIT,
		chains,
		triggerChainIngestion,
	);

	// Count results
	const successful = results.filter((r) => r).length;
	const failed = results.length - successful;

	const summary: DailyIngestionResult = {
		totalChains: chains.length,
		successful,
		failed,
	};

	log.info("Daily ingestion triggers completed", { ...summary });

	return summary;
}
