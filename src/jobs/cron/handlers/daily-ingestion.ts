/**
 * Daily Ingestion Cron Handler
 *
 * Triggers ingestion for all chains via the Go service.
 * This is a port of the original daily-ingestion worker to the new cron system.
 */

import { goFetch } from "@/lib/go-service-client";
import { createLogger } from "@/utils/logger";
import type {
	CronExecutionContext,
	CronJobHandler,
	TaskToEnqueue,
} from "../types";

const log = createLogger("daily-ingestion");

/**
 * Daily ingestion handler implementation
 *
 * Fetches the list of chains from the Go service and triggers
 * ingestion for each one. Returns a list of tasks representing
 * the ingestion triggers.
 */
export const dailyIngestionHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<TaskToEnqueue[]> {
		log.info("Starting daily ingestion job", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			isManual: context.isManual,
		});

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
			log.error("Failed to fetch chains from Go service", {}, error);
			throw error;
		}

		const tasks: TaskToEnqueue[] = [];
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

				// Record this as a task that was "enqueued" (executed)
				tasks.push({
					type: "chain-ingestion",
					payload: {
						chainSlug: chain,
						goRunId: result.runId,
					},
					idempotencyKey: `ingestion:${chain}:${context.scheduledFor.toISOString()}`,
				});

				successful++;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log.error(`Failed to trigger ingestion for ${chain}`, {
					error: message,
				});
				failed++;
			}
		}

		log.info("Daily ingestion triggers completed", {
			runId: context.runId,
			totalChains: chains.length,
			successful,
			failed,
		});

		return tasks;
	},
};
