/**
 * Daily Ingestion Cron Handler
 *
 * Schedules ingestion tasks for all configured chains.
 */

import { chainIds } from "@/ingestion/adapters/config";
import { formatDateInTimezone } from "@/ingestion/time";
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
 * Builds ingestion tasks for each chain. Returns tasks to enqueue.
 */
export const dailyIngestionHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<TaskToEnqueue[]> {
		log.info("Starting daily ingestion job", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			isManual: context.isManual,
		});

		const configuredChains = (process.env.INGESTION_CHAINS || "")
			.split(",")
			.map((chain) => chain.trim())
			.filter(Boolean);
		const chains = configuredChains.length > 0 ? configuredChains : chainIds;
		const targetDate = formatDateInTimezone(
			context.scheduledFor,
			"Europe/Zagreb",
		);

		const tasks: TaskToEnqueue[] = [];

		for (const chain of chains) {
			log.info(`Queueing ingestion task for chain: ${chain}`);
			tasks.push({
				type: "ingestion",
				payload: {
					chainSlug: chain,
					targetDate,
					source: "scheduled",
				},
				idempotencyKey: `ingestion:${chain}:${targetDate}`,
				priority: 10, // Higher than categorize (5) to ensure ingestion runs first
			});
		}

		log.info("Daily ingestion tasks prepared", {
			runId: context.runId,
			totalChains: chains.length,
		});

		return tasks;
	},
};
