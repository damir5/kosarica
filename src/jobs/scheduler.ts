/**
 * Job Scheduler for Ingestion Pipeline
 *
 * Uses node-cron for scheduling background jobs.
 * Runs in the main process - works with Vite bundling.
 */

import cron from "node-cron";
import { runDailyIngestion } from "./workers/daily-ingestion";
import { createLogger } from "@/utils/logger";

const log = createLogger("scheduler");

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Initialize and start the job scheduler.
 *
 * Jobs run in the main process. For development, jobs can
 * also be triggered manually via API.
 */
export function startScheduler(): void {
	if (scheduledTask) {
		log.warn("Scheduler already running");
		return;
	}

	// Run at 6 AM every day (Croatian time is typically UTC+1 or UTC+2)
	scheduledTask = cron.schedule("0 6 * * *", async () => {
		log.info("Starting scheduled daily ingestion");
		try {
			const result = await runDailyIngestion();
			log.info("Scheduled ingestion completed", { ...result });
		} catch (error) {
			log.error("Scheduled ingestion failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	log.info("Scheduler started", { jobs: ["daily-ingestion"] });
}

/**
 * Stop the job scheduler gracefully.
 */
export function stopScheduler(): void {
	if (!scheduledTask) {
		return;
	}

	log.info("Stopping scheduler...");
	scheduledTask.stop();
	scheduledTask = null;
	log.info("Scheduler stopped");
}

/**
 * Manually trigger a job by name.
 * Useful for API-triggered ingestion runs.
 *
 * @param jobName - Name of the job to run
 */
export async function runJob(jobName: string): Promise<void> {
	log.info("Manually triggering job", { jobName });

	if (jobName === "daily-ingestion") {
		const result = await runDailyIngestion();
		log.info("Manual job completed", { jobName, ...result });
	} else {
		throw new Error(`Unknown job: ${jobName}`);
	}
}

/**
 * Check if the scheduler is running.
 */
export function isSchedulerRunning(): boolean {
	return scheduledTask !== null;
}
