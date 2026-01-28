/**
 * Job Scheduler for Ingestion Pipeline
 *
 * Postgres-coordinated distributed cron scheduler.
 *
 * Architecture:
 * - Uses node-cron for tick scheduling (every 10 seconds)
 * - PostgreSQL advisory locks ensure single-leader execution
 * - Jobs synced to cron_jobs table when instance becomes leader
 * - Execution history stored in cron_runs table
 *
 * See AGENTS.md for details on adding new jobs.
 */

import { createLogger } from "@/utils/logger";
import {
	registerAllCronJobs,
	startTickLoop,
	stopTickLoop,
	getSchedulerHealth,
	executeJobManually,
} from "./cron";

const log = createLogger("scheduler");

/**
 * Initialize and start the job scheduler.
 *
 * Execution flow:
 * 1. registerAllCronJobs() populates in-memory registry (no DB access)
 * 2. startTickLoop() starts node-cron ticking every 10 seconds
 * 3. First tick: try advisory lock -> if leader, sync jobs to DB
 * 4. Subsequent ticks: find due jobs, execute them
 */
export function startScheduler(): void {
	// 1. Register all job handlers in memory (no DB access)
	registerAllCronJobs();

	// 2. Start tick loop (uses node-cron to tick every 10 seconds)
	startTickLoop();

	log.info("Cron scheduler started");
}

/**
 * Stop the job scheduler gracefully.
 *
 * Note: Advisory lock is released automatically when the tick loop stops.
 */
export function stopScheduler(): void {
	stopTickLoop();
	log.info("Scheduler stopped");
}

/**
 * Manually trigger a job by name.
 * Useful for API-triggered runs.
 *
 * @param jobName - Name/ID of the job to run
 * @returns The run ID
 */
export async function runJob(jobName: string): Promise<bigint> {
	log.info("Manually triggering job", { jobName });

	const runId = await executeJobManually(jobName);

	log.info("Manual job completed", { jobName, runId });
	return runId;
}

/**
 * Check if the scheduler is running.
 */
export function isSchedulerRunning(): boolean {
	return getSchedulerHealth().isRunning;
}

/**
 * Check if this instance is the scheduler leader.
 */
export function isSchedulerLeader(): boolean {
	return getSchedulerHealth().isLeader;
}
