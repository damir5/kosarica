/**
 * Cron Job Executor
 *
 * Handles claiming due jobs and executing them with idempotency guarantees.
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) to prevent race conditions.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import type { TaskQueuePayload } from "@/db/jsonb-schemas";
import { cronJobs, cronRuns } from "@/db/schema";
import { scheduleTask, type TaskType } from "@/lib/taskqueue";
import { getDb } from "@/utils/bindings";
import { createLogger, errorToObject } from "@/utils/logger";
import { getRegisteredJob } from "./registry";
import type {
	ClaimedJob,
	CronExecutionContext,
	CronJobRow,
	CronRunStatus,
	TaskToEnqueue,
} from "./types";
import { generateIdempotencyKey, getNextRun } from "./utils";

const log = createLogger("scheduler");

/**
 * Timeout for runs in "running" status before marking as failed (30 minutes)
 */
const STUCK_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Enqueue tasks to the task queue with error handling.
 *
 * @param tasks - Array of tasks to enqueue
 * @returns Object containing success and failure counts
 * @throws {Error} If no tasks could be enqueued
 */
async function enqueueTasks(
	tasks: TaskToEnqueue[],
): Promise<{ enqueued: number; failed: number }> {
	let enqueued = 0;
	let failed = 0;
	const errors: Array<{ task: TaskToEnqueue; error: string }> = [];

	for (const task of tasks) {
		let payload: TaskQueuePayload;

		switch (task.type) {
			case "ingestion":
				payload = { type: "ingestion", ...task.payload };
				break;
			case "rerun":
				payload = { type: "rerun", ...task.payload };
				break;
			case "cleanup":
				payload = { type: "cleanup", ...(task.payload ?? {}) };
				break;
			default: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const _exhaustiveCheck: never = task;
				failed += 1;
				errors.push({
					task,
					error: `Unknown task type: ${(_exhaustiveCheck as any).type}`,
				});
				continue;
			}
		}

		try {
			await scheduleTask({
				taskType: task.type as TaskType,
				payload,
			});
			enqueued += 1;
		} catch (error) {
			failed += 1;
			const message = error instanceof Error ? error.message : String(error);
			errors.push({ task, error: message });
		}
	}

	// Log partial failures
	if (failed > 0) {
		log.error("Some tasks failed to enqueue", {
			total: tasks.length,
			enqueued,
			failed,
			errors,
		});
	}

	// If all tasks failed, throw an error
	if (enqueued === 0 && tasks.length > 0) {
		throw new Error(
			`Failed to enqueue any tasks. Errors: ${errors.map((e) => e.error).join(", ")}`,
		);
	}

	return { enqueued, failed };
}

/**
 * Claim due jobs atomically using FOR UPDATE SKIP LOCKED
 *
 * This function:
 * 1. Finds jobs where next_run_at <= NOW() and enabled = true
 * 2. Locks them with FOR UPDATE SKIP LOCKED
 * 3. Updates next_run_at to the next scheduled time
 * 4. Returns the claimed jobs with their original scheduled_for time
 *
 * @returns Array of claimed jobs ready for execution
 */
export async function claimDueJobs(): Promise<ClaimedJob[]> {
	const db = getDb();
	const now = new Date();
	const nowIso = now.toISOString();

	// Use raw SQL for the atomic claim with FOR UPDATE SKIP LOCKED
	// Drizzle doesn't support FOR UPDATE SKIP LOCKED natively
	const result = await db.execute(sql`
		UPDATE cron_jobs
		SET
			next_run_at = NULL,
			updated_at = NOW()
		WHERE id IN (
			SELECT id FROM cron_jobs
			WHERE enabled = true
			AND next_run_at <= ${nowIso}::timestamptz
			FOR UPDATE SKIP LOCKED
		)
		RETURNING
			id,
			name,
			cron_expression,
			timezone,
			task_type,
			task_payload,
			enabled,
			next_run_at,
			last_run_at,
			last_run_status,
			created_at,
			updated_at
	`);

	const claimedJobs: ClaimedJob[] = [];
	const rows = ((result as { rows?: unknown[] }).rows ?? []) as Record<
		string,
		unknown
	>[];

	for (const row of rows) {
		// The scheduledFor is captured from before we nulled next_run_at
		// Since we already updated it, we need to calculate what it was
		// We stored nextRunAt = null, but we can derive scheduledFor from cron expression
		const job: CronJobRow = {
			id: row.id as string,
			name: row.name as string,
			cronExpression: row.cron_expression as string,
			timezone: (row.timezone as string) ?? "UTC",
			taskType: row.task_type as string,
			taskPayload: row.task_payload as Record<string, unknown> | null,
			enabled: row.enabled as boolean,
			nextRunAt: null, // We just set it to null
			lastRunAt: row.last_run_at as Date | null,
			lastRunStatus: row.last_run_status as string | null,
			createdAt: row.created_at as Date | null,
			updatedAt: row.updated_at as Date | null,
		};

		// For misfire policy: use now as the scheduled time
		// This ensures we only run once even if multiple schedules were missed
		const scheduledFor = now;

		claimedJobs.push({ job, scheduledFor });
	}

	if (claimedJobs.length > 0) {
		log.info("Claimed due jobs", {
			count: claimedJobs.length,
			jobIds: claimedJobs.map((c) => c.job.id),
		});
	}

	return claimedJobs;
}

/**
 * Execute a claimed job
 *
 * This function:
 * 1. Creates a cron_run record with idempotency key
 * 2. Calls the job handler to get tasks to enqueue
 * 3. Updates the run status based on result
 * 4. Updates the job's last_run_at and next_run_at
 *
 * @param claimed - The claimed job to execute
 */
export async function executeJob(claimed: ClaimedJob): Promise<void> {
	const { job, scheduledFor } = claimed;
	const db = getDb();
	const idempotencyKey = generateIdempotencyKey(job.id, scheduledFor);

	log.info("Executing job", {
		jobId: job.id,
		scheduledFor: scheduledFor.toISOString(),
		idempotencyKey,
	});

	// Try to insert the run record (idempotency check)
	let runId: bigint;
	try {
		const [insertedRun] = await db
			.insert(cronRuns)
			.values({
				jobId: job.id,
				idempotencyKey,
				status: "running",
				scheduledFor,
				startedAt: new Date(),
				createdAt: new Date(),
			})
			.returning({ id: cronRuns.id });

		runId = insertedRun.id;
	} catch (error) {
		// Unique constraint violation = already ran (PostgreSQL error code 23505)
		if ((error as { code?: string })?.code === "23505") {
			log.info("Job already executed (idempotency check)", {
				jobId: job.id,
				idempotencyKey,
			});
			// Update next_run_at since we claimed this job
			await updateJobNextRun(job);
			return;
		}
		throw error;
	}

	const context: CronExecutionContext = {
		jobId: job.id,
		runId,
		scheduledFor,
		isManual: false,
		payload: (job.taskPayload as Record<string, unknown> | null) ?? undefined,
	};

	let status: CronRunStatus = "completed";
	let errorMessage: string | undefined;
	let errorDetails: string | undefined;
	let tasksEnqueued = 0;

	try {
		// Get the registered handler
		const registeredJob = getRegisteredJob(job.id);

		if (!registeredJob?.handler) {
			log.warn("No handler registered for job", { jobId: job.id });
			status = "skipped";
		} else {
			// Execute the handler
			const tasks = await registeredJob.handler.execute(context);
			const result = await enqueueTasks(tasks);
			tasksEnqueued = result.enqueued;

			log.info("Job handler completed", {
				jobId: job.id,
				runId,
				tasksEnqueued,
				failed: result.failed,
			});
		}
	} catch (error) {
		status = "failed";
		errorMessage = error instanceof Error ? error.message : String(error);
		errorDetails = JSON.stringify(errorToObject(error));

		log.error("Job execution failed", { jobId: job.id, runId }, error);
	}

	// Update run record
	await db
		.update(cronRuns)
		.set({
			status,
			completedAt: new Date(),
			errorMessage,
			errorDetails,
			tasksEnqueued,
		})
		.where(eq(cronRuns.id, runId));

	// Update job record
	await db
		.update(cronJobs)
		.set({
			lastRunAt: new Date(),
			lastRunStatus: status,
			nextRunAt: getNextRun(job.cronExpression, job.timezone ?? "UTC"),
			updatedAt: new Date(),
		})
		.where(eq(cronJobs.id, job.id));

	log.info("Job execution completed", {
		jobId: job.id,
		runId,
		status,
		tasksEnqueued,
	});
}

/**
 * Update a job's next run time after claiming it
 * Used when idempotency check prevents execution
 */
async function updateJobNextRun(job: CronJobRow): Promise<void> {
	const db = getDb();
	const nextRunAt = getNextRun(job.cronExpression, job.timezone ?? "UTC");

	await db
		.update(cronJobs)
		.set({
			nextRunAt,
			updatedAt: new Date(),
		})
		.where(eq(cronJobs.id, job.id));
}

/**
 * Recover stuck runs
 *
 * Finds runs that have been in "running" status for too long
 * and marks them as failed. This handles cases where the process
 * crashed mid-execution.
 */
export async function recoverStuckRuns(): Promise<number> {
	const db = getDb();
	const cutoffTime = new Date(Date.now() - STUCK_RUN_TIMEOUT_MS);

	const result = await db
		.update(cronRuns)
		.set({
			status: "failed",
			completedAt: new Date(),
			errorMessage: "Run exceeded timeout (stuck recovery)",
		})
		.where(
			and(eq(cronRuns.status, "running"), lt(cronRuns.startedAt, cutoffTime)),
		)
		.returning({ id: cronRuns.id, jobId: cronRuns.jobId });

	if (result.length > 0) {
		log.warn("Recovered stuck runs", {
			count: result.length,
			runIds: result.map((r) => r.id),
		});

		// Re-enable jobs that were stuck
		for (const run of result) {
			const [job] = await db
				.select()
				.from(cronJobs)
				.where(eq(cronJobs.id, run.jobId));

			if (job && job.nextRunAt === null) {
				const nextRunAt = getNextRun(job.cronExpression, job.timezone ?? "UTC");
				await db
					.update(cronJobs)
					.set({ nextRunAt, updatedAt: new Date() })
					.where(eq(cronJobs.id, job.id));

				log.info("Re-enabled job after stuck recovery", {
					jobId: job.id,
					nextRunAt: nextRunAt.toISOString(),
				});
			}
		}
	}

	return result.length;
}

/**
 * Execute a job manually (for API trigger)
 *
 * Similar to executeJob but uses a manual idempotency key prefix
 * so it can run concurrently with scheduled runs.
 *
 * @param jobId - The job ID to execute
 * @param payloadOverride - Optional payload to override job config
 * @returns The run ID
 */
export async function executeJobManually(
	jobId: string,
	payloadOverride?: Record<string, unknown>,
): Promise<bigint> {
	const db = getDb();

	// Get the job
	const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, jobId));

	if (!job) {
		throw new Error(`Job not found: ${jobId}`);
	}

	const now = new Date();
	const idempotencyKey = `manual:${jobId}:${now.getTime()}`;

	log.info("Manually executing job", { jobId, idempotencyKey });

	// Insert run record
	const [insertedRun] = await db
		.insert(cronRuns)
		.values({
			jobId: job.id,
			idempotencyKey,
			status: "running",
			scheduledFor: now,
			startedAt: now,
			metadata: { manual: true, payloadOverride },
			createdAt: now,
		})
		.returning({ id: cronRuns.id });

	const runId = insertedRun.id;

	const context: CronExecutionContext = {
		jobId: job.id,
		runId,
		scheduledFor: now,
		isManual: true,
		payload:
			payloadOverride ??
			(job.taskPayload as Record<string, unknown> | null) ??
			undefined,
	};

	let status: CronRunStatus = "completed";
	let errorMessage: string | undefined;
	let errorDetails: string | undefined;
	let tasksEnqueued = 0;

	try {
		const registeredJob = getRegisteredJob(job.id);

		if (!registeredJob?.handler) {
			log.warn("No handler registered for job", { jobId: job.id });
			status = "skipped";
		} else {
			const tasks = await registeredJob.handler.execute(context);
			const result = await enqueueTasks(tasks);
			tasksEnqueued = result.enqueued;

			log.info("Manual job handler completed", {
				jobId: job.id,
				runId,
				tasksEnqueued,
				failed: result.failed,
			});
		}
	} catch (error) {
		status = "failed";
		errorMessage = error instanceof Error ? error.message : String(error);
		errorDetails = JSON.stringify(errorToObject(error));

		log.error("Manual job execution failed", { jobId: job.id, runId }, error);
	}

	// Update run record
	await db
		.update(cronRuns)
		.set({
			status,
			completedAt: new Date(),
			errorMessage,
			errorDetails,
			tasksEnqueued,
		})
		.where(eq(cronRuns.id, runId));

	return runId;
}
