/**
 * Cron Admin API Routes
 *
 * Admin endpoints for managing and monitoring cron jobs.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { cronJobs, cronRuns } from "@/db/schema";
import {
	executeJobManually,
	getNextRun,
	getRegisteredJobs,
	getSchedulerHealth,
} from "@/jobs/cron";
import { getDb } from "@/utils/bindings";
import { superadminProcedure } from "../base";

/**
 * List all cron jobs with their current status
 */
export const list = superadminProcedure.handler(async () => {
	const db = getDb();

	const jobs = await db.select().from(cronJobs).orderBy(cronJobs.name);

	// Get registered jobs to check for handlers
	const registeredJobs = getRegisteredJobs();
	const registeredIds = new Set(registeredJobs.map((j) => j.id));

	return jobs.map((job) => ({
		...job,
		hasHandler: registeredIds.has(job.id),
	}));
});

/**
 * Get a specific job with recent runs
 */
export const get = superadminProcedure
	.input(z.object({ jobId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		const [job] = await db
			.select()
			.from(cronJobs)
			.where(eq(cronJobs.id, input.jobId));

		if (!job) {
			throw new Error(`Job not found: ${input.jobId}`);
		}

		// Get recent runs
		const recentRuns = await db
			.select()
			.from(cronRuns)
			.where(eq(cronRuns.jobId, input.jobId))
			.orderBy(desc(cronRuns.createdAt))
			.limit(10);

		// Check if handler is registered
		const registeredJobs = getRegisteredJobs();
		const hasHandler = registeredJobs.some((j) => j.id === input.jobId);

		return {
			job: { ...job, hasHandler },
			recentRuns,
		};
	});

/**
 * List runs with optional filtering
 */
export const listRuns = superadminProcedure
	.input(
		z.object({
			jobId: z.string().optional(),
			status: z
				.enum(["pending", "running", "completed", "failed", "skipped"])
				.optional(),
			limit: z.number().default(50),
			offset: z.number().default(0),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		const conditions = [];
		if (input.jobId) {
			conditions.push(eq(cronRuns.jobId, input.jobId));
		}
		if (input.status) {
			conditions.push(eq(cronRuns.status, input.status));
		}

		const runs = await db
			.select()
			.from(cronRuns)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(cronRuns.createdAt))
			.limit(input.limit)
			.offset(input.offset);

		// Get total count for pagination
		const [countResult] = await db
			.select({ count: sql<number>`count(*)` })
			.from(cronRuns)
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		return {
			runs,
			total: countResult?.count ?? 0,
			limit: input.limit,
			offset: input.offset,
		};
	});

/**
 * Manually trigger a job
 */
export const trigger = superadminProcedure
	.input(
		z.object({
			jobId: z.string(),
			payload: z.record(z.string(), z.unknown()).optional(),
		}),
	)
	.handler(async ({ input }) => {
		const runId = await executeJobManually(input.jobId, input.payload);

		return {
			success: true,
			runId,
			message: `Job ${input.jobId} triggered successfully`,
		};
	});

/**
 * Enable or disable a job
 */
export const toggle = superadminProcedure
	.input(
		z.object({
			jobId: z.string(),
			enabled: z.boolean(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		const [job] = await db
			.select()
			.from(cronJobs)
			.where(eq(cronJobs.id, input.jobId));

		if (!job) {
			throw new Error(`Job not found: ${input.jobId}`);
		}

		const updateData: {
			enabled: boolean;
			nextRunAt: Date | null;
			updatedAt: Date;
		} = {
			enabled: input.enabled,
			nextRunAt: null,
			updatedAt: new Date(),
		};

		// If enabling, calculate next run time
		if (input.enabled && !job.enabled) {
			updateData.nextRunAt = getNextRun(
				job.cronExpression,
				job.timezone ?? "UTC",
			);
		}

		await db
			.update(cronJobs)
			.set(updateData)
			.where(eq(cronJobs.id, input.jobId));

		return {
			success: true,
			enabled: input.enabled,
			nextRunAt: updateData.nextRunAt,
		};
	});

/**
 * Get scheduler health status
 */
export const health = superadminProcedure.handler(async () => {
	const db = getDb();
	const schedulerHealth = getSchedulerHealth();

	// Get job counts
	const [enabledCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(cronJobs)
		.where(eq(cronJobs.enabled, true));

	const [totalCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(cronJobs);

	// Get recent run stats
	const [recentRunStats] = await db
		.select({
			total: sql<number>`count(*)`,
			completed: sql<number>`count(*) FILTER (WHERE status = 'completed')`,
			failed: sql<number>`count(*) FILTER (WHERE status = 'failed')`,
			running: sql<number>`count(*) FILTER (WHERE status = 'running')`,
		})
		.from(cronRuns)
		.where(sql`created_at > NOW() - INTERVAL '24 hours'`);

	return {
		scheduler: schedulerHealth,
		jobs: {
			enabled: enabledCount?.count ?? 0,
			total: totalCount?.count ?? 0,
		},
		recentRuns: {
			total: recentRunStats?.total ?? 0,
			completed: recentRunStats?.completed ?? 0,
			failed: recentRunStats?.failed ?? 0,
			running: recentRunStats?.running ?? 0,
		},
	};
});

/**
 * Get a specific run by ID
 */
export const getRun = superadminProcedure
	.input(z.object({ runId: z.coerce.bigint() }))
	.handler(async ({ input }) => {
		const db = getDb();

		const [run] = await db
			.select()
			.from(cronRuns)
			.where(eq(cronRuns.id, input.runId));

		if (!run) {
			throw new Error(`Run not found: ${input.runId}`);
		}

		// Get job info
		const [job] = await db
			.select()
			.from(cronJobs)
			.where(eq(cronJobs.id, run.jobId));

		return { run, job };
	});
