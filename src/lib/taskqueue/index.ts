import { eq, sql } from "drizzle-orm";
import { getDatabase, taskQueue } from "@/db";
import type { TaskQueuePayload } from "@/db/jsonb-schemas";

export type TaskStatus =
	| "pending"
	| "claimed"
	| "processing"
	| "completed"
	| "failed"
	| "cancelled"
	| "waiting_for_children";
export type TaskType =
	| "ingestion"
	| "rerun"
	| "cleanup"
	| "clickhouse"
	| "categorize"
	| "barcode-anchor"
	| "matching";

export interface ClaimedTask {
	id: string;
	task_type: string;
	payload: unknown;
}

export interface ScheduleTaskOptions {
	taskType: TaskType;
	payload: TaskQueuePayload;
	priority?: number;
	scheduledFor?: Date;
	maxRetries?: number;
}

export async function scheduleTask(
	options: ScheduleTaskOptions,
): Promise<{ id: string }> {
	const db = getDatabase();
	const result = await db
		.insert(taskQueue)
		.values({
			taskType: options.taskType,
			payload: options.payload,
			priority: options.priority ?? 0,
			scheduledFor: options.scheduledFor ?? sql`NOW()`,
			maxRetries: options.maxRetries ?? 3,
		})
		.returning({ id: taskQueue.id });
	const row = result[0];
	return { id: row.id };
}

export async function claimTasks(
	workerId: string,
	maxTasks: number,
	taskTypes?: TaskType[],
): Promise<ClaimedTask[]> {
	const db = getDatabase();
	const taskTypeFilter =
		taskTypes && taskTypes.length > 0
			? sql`AND tq.task_type = ANY(${sql.raw(`ARRAY[${taskTypes.map((t) => `'${t}'`).join(",")}]`)})`
			: sql``;
	const result = await db.execute(sql`
		WITH claimed AS (
			SELECT tq.id, tq.task_type, tq.payload
			FROM task_queue tq
			WHERE tq.status = 'pending'
				AND tq.scheduled_for <= NOW()
				${taskTypeFilter}
			ORDER BY tq.priority DESC, tq.scheduled_for ASC
			FOR UPDATE SKIP LOCKED
			LIMIT ${maxTasks}
		)
		UPDATE task_queue tq
		SET status = 'claimed',
			started_at = NOW(),
			worker_id = ${workerId},
			updated_at = NOW()
		FROM claimed c
		WHERE tq.id = c.id
		RETURNING tq.id, tq.task_type, tq.payload
	`);
	const resultRows = Array.isArray(result)
		? (result as unknown[])
		: ((result as { rows?: unknown[] }).rows ?? []);
	return resultRows as ClaimedTask[];
}

export async function completeTask(taskId: string): Promise<boolean> {
	const db = getDatabase();
	const result = await db.execute(sql`
		WITH completed AS (
			UPDATE task_queue
			SET status = 'completed',
				completed_at = NOW(),
				updated_at = NOW()
			WHERE id = ${taskId}
				AND status = 'processing'
			RETURNING id, parent_task_id
		),
		parent_updated AS (
			UPDATE task_queue
			SET completed_children = completed_children + 1,
				updated_at = NOW()
			WHERE id IN (
				SELECT parent_task_id
				FROM completed
				WHERE parent_task_id IS NOT NULL
			)
			RETURNING id
		)
		UPDATE task_queue
		SET status = 'pending',
			scheduled_for = NOW(),
			updated_at = NOW()
		WHERE id IN (
			SELECT parent_task_id
			FROM completed
			WHERE parent_task_id IS NOT NULL
		)
			AND status = 'waiting_for_children'
			AND completed_children >= expected_children
		RETURNING (SELECT COUNT(*) FROM completed) AS completed_count
	`);
	const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
		completed_count?: number;
	}>;
	return Number(rows[0]?.completed_count ?? 0) > 0;
}

export async function startProcessing(taskId: string): Promise<void> {
	const db = getDatabase();
	await db
		.update(taskQueue)
		.set({
			status: "processing" as const,
			updatedAt: sql`NOW()`,
		})
		.where(eq(taskQueue.id, taskId));
}

export async function failTask(
	taskId: string,
	errorMessage: string,
	shouldRetry: boolean = true,
): Promise<boolean> {
	const db = getDatabase();
	const result = await db.execute(sql`
		WITH task AS (
			SELECT retry_count, max_retries
			FROM task_queue
			WHERE id = ${taskId}
			FOR UPDATE
		),
		updated AS (
			UPDATE task_queue
			SET status = CASE
					WHEN ${shouldRetry} AND retry_count < max_retries THEN 'pending'
					ELSE 'failed'
				END,
				worker_id = NULL,
				started_at = NULL,
				retry_count = CASE
					WHEN ${shouldRetry} AND retry_count < max_retries THEN retry_count + 1
					ELSE retry_count
				END,
				scheduled_for = CASE
					WHEN ${shouldRetry} AND retry_count < max_retries
						THEN NOW() + ((retry_count + 2) * INTERVAL '1 minute')
					ELSE scheduled_for
				END,
				failed_at = CASE
					WHEN NOT (${shouldRetry} AND retry_count < max_retries)
						THEN NOW()
					ELSE NULL
				END,
				error_message = ${errorMessage},
				updated_at = NOW()
			WHERE id = ${taskId}
			RETURNING status
		)
		SELECT status FROM updated
	`);
	const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
		status?: string;
	}>;
	return rows[0]?.status === "pending";
}

export async function cleanupOldTasks(daysToKeep: number = 7): Promise<number> {
	const db = getDatabase();
	const result = await db.execute(sql`
		WITH deleted AS (
			DELETE FROM task_queue
			WHERE status = 'completed'
				AND completed_at < NOW() - (${daysToKeep} || ' days')::INTERVAL
			RETURNING 1
		)
		SELECT COUNT(*)::int AS count FROM deleted
	`);
	const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
		count?: number;
	}>;
	return Number(rows[0]?.count ?? 0);
}

export async function recoverOrphanedTasks(): Promise<{
	recoveredCount: number;
	failedCount: number;
}> {
	const db = getDatabase();
	const result = await db.execute(sql`
		WITH recovered AS (
			UPDATE task_queue
			SET status = 'pending',
				worker_id = NULL,
				started_at = NULL,
				updated_at = NOW()
			WHERE status = 'claimed'
				AND started_at < NOW() - INTERVAL '15 minutes'
			RETURNING id
		),
		failed AS (
			UPDATE task_queue
			SET status = CASE
					WHEN retry_count < max_retries THEN 'pending'
					ELSE 'failed'
				END,
				retry_count = CASE
					WHEN retry_count < max_retries THEN retry_count + 1
					ELSE retry_count
				END,
				scheduled_for = CASE
					WHEN retry_count < max_retries
						THEN NOW() + ((retry_count + 2) * INTERVAL '1 minute')
					ELSE scheduled_for
				END,
				failed_at = CASE
					WHEN retry_count >= max_retries THEN NOW()
					ELSE NULL
				END,
				error_message = 'Recovered from orphaned processing state',
				worker_id = NULL,
				updated_at = NOW()
			WHERE status = 'processing'
				AND started_at < NOW() - INTERVAL '15 minutes'
			RETURNING id
		)
		SELECT
			(SELECT COUNT(*)::int FROM recovered) AS recovered_count,
			(SELECT COUNT(*)::int FROM failed) AS failed_count
	`);
	const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
		recovered_count?: number;
		failed_count?: number;
	}>;
	return {
		recoveredCount: Number(rows[0]?.recovered_count ?? 0),
		failedCount: Number(rows[0]?.failed_count ?? 0),
	};
}

export async function getTask(taskId: string): Promise<ClaimedTask | null> {
	const db = getDatabase();
	const result = await db
		.select({
			id: taskQueue.id,
			task_type: taskQueue.taskType,
			payload: taskQueue.payload,
			status: taskQueue.status,
			scheduled_for: taskQueue.scheduledFor,
			started_at: taskQueue.startedAt,
			completed_at: taskQueue.completedAt,
			failed_at: taskQueue.failedAt,
			worker_id: taskQueue.workerId,
			retry_count: taskQueue.retryCount,
			max_retries: taskQueue.maxRetries,
			error_message: taskQueue.errorMessage,
			created_at: taskQueue.createdAt,
			updated_at: taskQueue.updatedAt,
		})
		.from(taskQueue)
		.where(eq(taskQueue.id, taskId))
		.limit(1);
	return result[0] as unknown as ClaimedTask | null;
}
