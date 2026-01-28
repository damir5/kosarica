/**
 * Cron Job Registry
 *
 * In-memory registry for job handlers with database synchronization.
 * Jobs are registered in memory at startup, then synced to the database
 * when the instance becomes the leader.
 */

import { eq } from "drizzle-orm";
import { cronJobs } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import type { CronJobConfig, RegisteredJob } from "./types";
import { getNextRun, parseCronExpression } from "./utils";

const log = createLogger("scheduler");

/**
 * In-memory registry of job configurations and handlers
 */
const jobRegistry = new Map<string, RegisteredJob>();

/**
 * Register a cron job with its handler
 * Called at application startup to populate the registry
 *
 * @param config - Job configuration including handler
 * @throws Error if cron expression is invalid
 */
export function registerCronJob(config: CronJobConfig): void {
	// Validate cron expression early to fail fast at registration time
	try {
		parseCronExpression(config.cronExpression, config.timezone ?? "UTC");
	} catch (e) {
		throw new Error(
			`Invalid cron expression for job ${config.id}: ${config.cronExpression}`,
		);
	}

	if (jobRegistry.has(config.id)) {
		log.warn("Job already registered, overwriting", { jobId: config.id });
	}

	jobRegistry.set(config.id, {
		...config,
	});

	log.debug("Job registered", {
		jobId: config.id,
		name: config.name,
		cron: config.cronExpression,
		timezone: config.timezone ?? "UTC",
	});
}

/**
 * Get all registered jobs
 */
export function getRegisteredJobs(): RegisteredJob[] {
	return Array.from(jobRegistry.values());
}

/**
 * Get a specific registered job by ID
 */
export function getRegisteredJob(jobId: string): RegisteredJob | undefined {
	return jobRegistry.get(jobId);
}

/**
 * Synchronize registered jobs to the database
 *
 * Called once when an instance becomes leader.
 * Upserts job definitions and calculates next_run_at for new jobs.
 */
export async function syncJobsToDatabase(): Promise<void> {
	const db = getDb();
	const registeredJobs = getRegisteredJobs();

	if (registeredJobs.length === 0) {
		log.warn("No jobs registered to sync");
		return;
	}

	log.info("Syncing jobs to database", { count: registeredJobs.length });

	for (const job of registeredJobs) {
		const timezone = job.timezone ?? "UTC";
		const nextRunAt = getNextRun(job.cronExpression, timezone);

		try {
			// Check if job exists
			const [existing] = await db
				.select()
				.from(cronJobs)
				.where(eq(cronJobs.id, job.id));

			if (existing) {
				// Update existing job (preserve enabled state and next_run_at if already set)
				await db
					.update(cronJobs)
					.set({
						name: job.name,
						cronExpression: job.cronExpression,
						timezone,
						taskType: job.taskType,
						taskPayload: job.taskPayload ?? null,
						updatedAt: new Date(),
						// Only update nextRunAt if it's null (job was previously disabled or new)
						...(existing.nextRunAt === null ? { nextRunAt } : {}),
					})
					.where(eq(cronJobs.id, job.id));

				log.debug("Job updated in database", { jobId: job.id });
			} else {
				// Insert new job
				await db.insert(cronJobs).values({
					id: job.id,
					name: job.name,
					cronExpression: job.cronExpression,
					timezone,
					taskType: job.taskType,
					taskPayload: job.taskPayload ?? null,
					enabled: true,
					nextRunAt,
					createdAt: new Date(),
					updatedAt: new Date(),
				});

				log.info("Job created in database", {
					jobId: job.id,
					nextRunAt: nextRunAt.toISOString(),
				});
			}
		} catch (error) {
			log.error("Failed to sync job to database", { jobId: job.id }, error);
			throw error;
		}
	}

	log.info("Jobs synced to database", { count: registeredJobs.length });
}

/**
 * Clear the job registry (for testing)
 */
export function clearRegistry(): void {
	jobRegistry.clear();
}
