/**
 * Job Scheduler for Ingestion Pipeline
 *
 * Uses Bree for scheduling background jobs. Replaces Cloudflare Queues
 * with direct function calls for a single-server Node.js deployment.
 */

import Bree from "bree";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@/utils/logger";

const log = createLogger("scheduler");

// Get directory of this file for worker paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let bree: Bree | null = null;

/**
 * Initialize and start the job scheduler.
 *
 * Jobs are defined with cron schedules and run as worker threads.
 * For development, jobs can also be triggered manually via API.
 */
export async function startScheduler(): Promise<void> {
	if (bree) {
		log.warn("Scheduler already running");
		return;
	}

	const workerPath = path.join(__dirname, "workers");

	bree = new Bree({
		root: workerPath,
		// Disable default error handler as we handle errors ourselves
		hasSeconds: false,
		jobs: [
			{
				name: "daily-ingestion",
				// Run at 6 AM every day (Croatian time is typically UTC+1 or UTC+2)
				cron: "0 6 * * *",
				// Also allow manual triggering
			},
		],
		workerMessageHandler: (metadata) => {
			log.info("Worker message received", {
				name: metadata.name,
				message: metadata.message,
			});
		},
		errorHandler: (error, workerMetadata) => {
			log.error("Worker error", {
				name: workerMetadata.name,
				error: error.message,
			});
		},
	});

	// Handle job start/stop events
	bree.on("worker created", (name) => {
		log.info("Worker created", { name });
	});

	bree.on("worker deleted", (name) => {
		log.info("Worker deleted", { name });
	});

	await bree.start();
	log.info("Scheduler started", {
		jobs: bree.config.jobs.map((j) => (typeof j === "string" ? j : j.name)),
	});
}

/**
 * Stop the job scheduler gracefully.
 */
export async function stopScheduler(): Promise<void> {
	if (!bree) {
		return;
	}

	log.info("Stopping scheduler...");
	await bree.stop();
	bree = null;
	log.info("Scheduler stopped");
}

/**
 * Manually trigger a job by name.
 * Useful for API-triggered ingestion runs.
 *
 * @param jobName - Name of the job to run
 */
export async function runJob(jobName: string): Promise<void> {
	if (!bree) {
		throw new Error("Scheduler not running");
	}

	log.info("Manually triggering job", { jobName });
	await bree.run(jobName);
}

/**
 * Check if the scheduler is running.
 */
export function isSchedulerRunning(): boolean {
	return bree !== null;
}
