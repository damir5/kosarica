/**
 * Cron Tick Loop
 *
 * Uses node-cron to schedule periodic ticks.
 * A dedicated PostgreSQL client maintains the advisory lock for leadership.
 * Only the leader instance executes jobs.
 */

import cron from "node-cron";
import { Client } from "pg";
import { createLogger } from "@/utils/logger";
import { claimDueJobs, executeJob, recoverStuckRuns } from "./executor";
import { syncJobsToDatabase } from "./registry";
import { isConnectionError } from "./utils";

const log = createLogger("scheduler");

/**
 * Advisory lock ID for scheduler leadership
 * This is a unique integer that identifies our lock
 */
const SCHEDULER_LOCK_ID = 1952534;

/**
 * Tick interval in cron expression format (every 10 seconds)
 */
const TICK_INTERVAL = "*/10 * * * * *";

// Module state
let isLeader = false;
let hasSyncedJobs = false;
let isTickRunning = false;
let tickTask: cron.ScheduledTask | null = null;
let leaderClient: Client | null = null;
let leaderSince: Date | null = null;
let lastTickAt: Date | null = null;
let isShuttingDown = false;

/**
 * Get the DATABASE_URL from environment
 */
function getDatabaseUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL environment variable is not set");
	}
	return url;
}

/**
 * Start the tick loop
 *
 * Schedules a node-cron task that runs every 10 seconds.
 * Each tick attempts to acquire leadership and execute due jobs.
 */
export function startTickLoop(): void {
	if (tickTask) {
		log.warn("Tick loop already running");
		return;
	}

	tickTask = cron.schedule(TICK_INTERVAL, () => {
		// Don't await - fire and forget, but safeTick handles overlaps
		safeTick().catch((err) => {
			log.error("Unhandled tick error", {}, err);
		});
	});

	// Register shutdown handlers (use once() to prevent duplicate registrations)
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);

	log.info("Tick loop started", { interval: TICK_INTERVAL });
}

/**
 * Stop the tick loop
 *
 * Releases the advisory lock and closes the dedicated DB connection.
 */
export async function stopTickLoop(): Promise<void> {
	if (!tickTask) {
		return;
	}

	tickTask.stop();
	tickTask = null;

	// Release advisory lock and close connection
	if (leaderClient) {
		try {
			if (isLeader) {
				await leaderClient.query("SELECT pg_advisory_unlock($1)", [
					SCHEDULER_LOCK_ID,
				]);
				log.info("Released scheduler leadership lock");
			}
			await leaderClient.end();
		} catch (error) {
			log.error("Error during stopTickLoop cleanup", {}, error);
		}
		leaderClient = null;
	}

	isLeader = false;
	hasSyncedJobs = false;
	leaderSince = null;

	log.info("Tick loop stopped");
}

/**
 * Graceful shutdown
 *
 * Releases the advisory lock and closes the dedicated connection.
 */
async function shutdown(): Promise<void> {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;

	log.info("Shutting down scheduler...");

	// Stop the tick task
	if (tickTask) {
		tickTask.stop();
		tickTask = null;
	}

	// Release advisory lock and close connection
	if (leaderClient) {
		try {
			if (isLeader) {
				await leaderClient.query("SELECT pg_advisory_unlock($1)", [
					SCHEDULER_LOCK_ID,
				]);
				log.info("Released scheduler leadership lock");
			}
			await leaderClient.end();
		} catch (error) {
			log.error("Error during shutdown", {}, error);
		}
		leaderClient = null;
	}

	isLeader = false;
	hasSyncedJobs = false;
	leaderSince = null;

	log.info("Scheduler shutdown complete");
}

/**
 * Safe tick wrapper
 *
 * Prevents overlapping ticks and handles errors gracefully.
 */
async function safeTick(): Promise<void> {
	// Tick mutex - prevent overlapping ticks
	if (isTickRunning) {
		log.debug("Tick already running, skipping");
		return;
	}

	if (isShuttingDown) {
		return;
	}

	isTickRunning = true;

	try {
		await tick();
		lastTickAt = new Date();
	} catch (err) {
		log.error("Tick error", {}, err);

		// Lost connection = lost leadership
		if (isConnectionError(err)) {
			log.warn("Connection error detected, resetting leadership state");
			isLeader = false;
			hasSyncedJobs = false;
			leaderSince = null;

			// Clean up the broken connection
			if (leaderClient) {
				try {
					await leaderClient.end();
				} catch {
					// Ignore cleanup errors
				}
				leaderClient = null;
			}
		}
	} finally {
		isTickRunning = false;
	}
}

/**
 * Main tick function
 *
 * 1. Try to acquire advisory lock (become leader)
 * 2. If leader, sync jobs on first tick
 * 3. Claim and execute due jobs
 */
async function tick(): Promise<void> {
	// 1. Try to acquire lock using dedicated client (not pool)
	if (!isLeader) {
		if (!leaderClient) {
			leaderClient = new Client({
				connectionString: getDatabaseUrl(),
			});
			await leaderClient.connect();
			log.debug("Created dedicated connection for leadership");
		}

		const { rows } = await leaderClient.query(
			"SELECT pg_try_advisory_lock($1) as acquired",
			[SCHEDULER_LOCK_ID],
		);
		const acquired = rows[0]?.acquired as boolean;

		if (acquired) {
			isLeader = true;
			leaderSince = new Date();
			log.info("Acquired scheduler leadership", {
				lockId: SCHEDULER_LOCK_ID,
			});
		}
	}

	if (!isLeader) {
		log.debug("Not leader, waiting for next tick");
		return;
	}

	// 2. Sync jobs on first tick after becoming leader
	if (!hasSyncedJobs) {
		log.info("Syncing jobs to database (first tick as leader)");
		await syncJobsToDatabase();
		hasSyncedJobs = true;

		// Also recover any stuck runs from previous leader crash
		const recoveredCount = await recoverStuckRuns();
		if (recoveredCount > 0) {
			log.info("Recovered stuck runs on leadership acquisition", {
				count: recoveredCount,
			});
		}
	}

	// 3. Claim and execute due jobs atomically
	const dueJobs = await claimDueJobs();

	for (const claimed of dueJobs) {
		try {
			await executeJob(claimed);
		} catch (err) {
			log.error(
				"Job execution failed",
				{ jobId: claimed.job.id },
				err,
			);
		}
	}
}

/**
 * Get scheduler health information
 */
export function getSchedulerHealth(): {
	isLeader: boolean;
	lastTickAt: Date | null;
	leaderSince: Date | null;
	isRunning: boolean;
} {
	return {
		isLeader,
		lastTickAt,
		leaderSince,
		isRunning: tickTask !== null,
	};
}

/**
 * Check if this instance is the leader
 */
export function isSchedulerLeader(): boolean {
	return isLeader;
}

/**
 * Force release of leadership (for testing)
 */
export async function releaseLeadership(): Promise<void> {
	if (!isLeader || !leaderClient) {
		return;
	}

	try {
		await leaderClient.query("SELECT pg_advisory_unlock($1)", [
			SCHEDULER_LOCK_ID,
		]);
		isLeader = false;
		hasSyncedJobs = false;
		leaderSince = null;
		log.info("Released scheduler leadership");
	} catch (error) {
		log.error("Failed to release leadership", {}, error);
	}
}
