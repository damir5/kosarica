import { sql } from "drizzle-orm";
import { getDatabase } from "@/db";

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
	const result = await db.execute(sql`
    INSERT INTO task_queue (task_type, payload, priority, scheduled_for, max_retries)
    VALUES (${options.taskType}, ${JSON.stringify(options.payload)},
            ${options.priority ?? 0}, ${options.scheduledFor?.toISOString() ?? sql`NOW()`},
            ${options.maxRetries ?? 3})
    RETURNING id
  `);
	return { id: result[0].id };
}

export async function claimTasks(
	workerId: string,
	taskTypes?: TaskType[],
	maxTasks: number,
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
	await db.execute(sql`
    UPDATE task_queue
    SET status = 'processing', updated_at = NOW()
    WHERE id = ${taskId}
  `);
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
	const result = await db.execute(sql`
    SELECT id, task_type, payload, status,
           scheduled_for, started_at, completed_at, failed_at,
           worker_id, retry_count, max_retries, error_message,
           created_at, updated_at
    FROM task_queue
    WHERE id = ${taskId}
  `);
	return result[0] as unknown as ClaimedTask | null;
}
