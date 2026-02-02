import { eq, sql } from "drizzle-orm";
import { getDatabase, taskQueue } from "@/db";

export type TaskStatus =
	| "pending"
	| "processing"
	| "completed"
	| "failed"
	| "cancelled";
export type TaskType = "ingestion" | "rerun" | "cleanup";

export interface ClaimedTask {
	id: string;
	task_type: string;
	payload: unknown;
}

export interface ScheduleTaskOptions {
	taskType: TaskType;
	payload: Record<string, unknown>;
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
			payload: options.payload as any, // JSONB typed column
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
	const taskTypesArray = taskTypes
		? sql`ARRAY[${taskTypes.join(",")}]`
		: sql`NULL`;
	const result = await db.execute(sql`
    SELECT * FROM claim_tasks(${workerId}, ${taskTypesArray}::text[], ${maxTasks})
  `);
	return result as unknown as ClaimedTask[];
}

export async function completeTask(taskId: string): Promise<boolean> {
	const db = getDatabase();
	const result = await db.execute(sql`SELECT complete_task(${taskId})`);
	return result[0].complete_task as boolean;
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
    SELECT fail_task(${taskId}, ${errorMessage}, ${shouldRetry})
  `);
	return result[0].fail_task as boolean;
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
