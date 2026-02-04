/**
 * Task Queue Admin API Routes
 *
 * Admin endpoints for monitoring and administering the Postgres-backed task queue.
 */

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { taskQueue } from "@/db/schema";
import { cleanupOldTasks, recoverOrphanedTasks } from "@/lib/taskqueue";
import { getDb } from "@/utils/bindings";
import { superadminProcedure } from "../base";

function getRows<T>(result: unknown): T[] {
	return Array.isArray(result)
		? (result as unknown as T[])
		: (((result as { rows?: unknown[] }).rows ?? []) as unknown as T[]);
}

const TaskStatusSchema = z.enum([
	"pending",
	"claimed",
	"processing",
	"completed",
	"failed",
	"cancelled",
	"waiting_for_children",
]);

const TaskTypeSchema = z.enum(["ingestion", "rerun", "cleanup", "clickhouse"]);

const SortFieldSchema = z.enum([
	"createdAt",
	"scheduledFor",
	"updatedAt",
	"priority",
]);

export const stats = superadminProcedure.handler(async () => {
	const db = getDb();

	const statusAgg = await db.execute(sql`
		SELECT status, COUNT(*)::int AS count
		FROM task_queue
		GROUP BY status
	`);

	const typeAgg = await db.execute(sql`
		SELECT task_type AS type, COUNT(*)::int AS count
		FROM task_queue
		GROUP BY task_type
	`);

	const stuckAggResult = await db.execute(sql`
			SELECT
				COUNT(*) FILTER (
					WHERE status = 'claimed' AND started_at < NOW() - INTERVAL '15 minutes'
				)::int AS claimed,
				COUNT(*) FILTER (
					WHERE status = 'processing' AND started_at < NOW() - INTERVAL '15 minutes'
				)::int AS processing
			FROM task_queue
		`);
	const [stuckAgg] = getRows<{ claimed: number; processing: number }>(
		stuckAggResult,
	);

	const nextPendingResult = await db.execute(sql`
			SELECT MIN(scheduled_for) AS next
			FROM task_queue
			WHERE status = 'pending'
		`);
	const [nextPending] = getRows<{ next: Date | string | null }>(
		nextPendingResult,
	);

	const statusRows = getRows<{ status: string; count: number | string }>(
		statusAgg,
	);
	const typeRows = getRows<{ type: string; count: number | string }>(typeAgg);

	const nextPendingAtRaw = nextPending?.next ?? null;
	const nextPendingAt = nextPendingAtRaw ? new Date(nextPendingAtRaw) : null;

	return {
		byStatus: statusRows.map((r) => ({
			status: r.status,
			count: Number(r.count ?? 0),
		})),
		byType: typeRows.map((r) => ({
			type: r.type,
			count: Number(r.count ?? 0),
		})),
		stuck: {
			claimed: Number(stuckAgg?.claimed ?? 0),
			processing: Number(stuckAgg?.processing ?? 0),
		},
		nextPendingAt,
	};
});

export const list = superadminProcedure
	.input(
		z.object({
			status: z.array(TaskStatusSchema).optional(),
			taskType: z.array(TaskTypeSchema).optional(),
			workerId: z.string().optional(),
			search: z.string().optional(),
			stuckOnly: z.boolean().optional().default(false),
			sort: z
				.object({
					field: SortFieldSchema.default("createdAt"),
					direction: z.enum(["asc", "desc"]).default("desc"),
				})
				.optional(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const conditions = [];

		if (input.status?.length) {
			conditions.push(inArray(taskQueue.status, input.status));
		}
		if (input.taskType?.length) {
			conditions.push(inArray(taskQueue.taskType, input.taskType));
		}
		if (input.workerId) {
			conditions.push(eq(taskQueue.workerId, input.workerId));
		}
		if (input.search && input.search.trim().length > 0) {
			const q = `%${input.search.trim()}%`;
			conditions.push(
				or(
					sql`${taskQueue.id} ILIKE ${q}`,
					sql`${taskQueue.errorMessage} ILIKE ${q}`,
					sql`${taskQueue.payload}::text ILIKE ${q}`,
				),
			);
		}
		if (input.stuckOnly) {
			conditions.push(
				or(
					and(
						eq(taskQueue.status, "claimed"),
						sql`${taskQueue.startedAt} < NOW() - INTERVAL '15 minutes'`,
					),
					and(
						eq(taskQueue.status, "processing"),
						sql`${taskQueue.startedAt} < NOW() - INTERVAL '15 minutes'`,
					),
				),
			);
		}

		const where = conditions.length ? and(...conditions) : undefined;

		const sortField = input.sort?.field ?? "createdAt";
		const sortDirection = input.sort?.direction ?? "desc";
		const orderBy = (() => {
			const dir = sortDirection === "asc" ? "asc" : "desc";
			switch (sortField) {
				case "scheduledFor":
					return dir === "asc"
						? taskQueue.scheduledFor
						: desc(taskQueue.scheduledFor);
				case "updatedAt":
					return dir === "asc"
						? taskQueue.updatedAt
						: desc(taskQueue.updatedAt);
				case "priority":
					return dir === "asc" ? taskQueue.priority : desc(taskQueue.priority);
				default:
					return dir === "asc"
						? taskQueue.createdAt
						: desc(taskQueue.createdAt);
			}
		})();

		const tasks = await db
			.select({
				id: taskQueue.id,
				taskType: taskQueue.taskType,
				payload: taskQueue.payload,
				priority: taskQueue.priority,
				status: taskQueue.status,
				scheduledFor: taskQueue.scheduledFor,
				startedAt: taskQueue.startedAt,
				completedAt: taskQueue.completedAt,
				failedAt: taskQueue.failedAt,
				workerId: taskQueue.workerId,
				retryCount: taskQueue.retryCount,
				maxRetries: taskQueue.maxRetries,
				errorMessage: taskQueue.errorMessage,
				parentTaskId: taskQueue.parentTaskId,
				expectedChildren: taskQueue.expectedChildren,
				completedChildren: taskQueue.completedChildren,
				createdAt: taskQueue.createdAt,
				updatedAt: taskQueue.updatedAt,
			})
			.from(taskQueue)
			.where(where)
			.orderBy(orderBy)
			.limit(input.limit)
			.offset(input.offset);

		const [countResult] = await db
			.select({ count: sql<number>`count(*)` })
			.from(taskQueue)
			.where(where);

		return {
			tasks,
			total: Number(countResult?.count ?? 0),
			limit: input.limit,
			offset: input.offset,
		};
	});

export const get = superadminProcedure
	.input(z.object({ taskId: z.string().min(1) }))
	.handler(async ({ input }) => {
		const db = getDb();
		const [task] = await db
			.select()
			.from(taskQueue)
			.where(eq(taskQueue.id, input.taskId))
			.limit(1);

		if (!task) {
			throw new Error(`Task not found: ${input.taskId}`);
		}
		return task;
	});

export const cancel = superadminProcedure
	.input(z.object({ taskId: z.string().min(1) }))
	.handler(async ({ input }) => {
		const db = getDb();
		const [task] = await db
			.select({ status: taskQueue.status })
			.from(taskQueue)
			.where(eq(taskQueue.id, input.taskId))
			.limit(1);

		if (!task) {
			throw new Error(`Task not found: ${input.taskId}`);
		}
		if (task.status !== "pending" && task.status !== "claimed") {
			throw new Error(
				`Can only cancel pending/claimed tasks (got: ${task.status})`,
			);
		}

		await db
			.update(taskQueue)
			.set({
				status: "cancelled",
				workerId: null,
				startedAt: null,
				updatedAt: sql`NOW()`,
			})
			.where(eq(taskQueue.id, input.taskId));

		return { success: true };
	});

export const requeue = superadminProcedure
	.input(
		z.object({
			taskId: z.string().min(1),
			resetRetry: z.boolean().optional().default(true),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const [task] = await db
			.select({ status: taskQueue.status })
			.from(taskQueue)
			.where(eq(taskQueue.id, input.taskId))
			.limit(1);

		if (!task) {
			throw new Error(`Task not found: ${input.taskId}`);
		}
		if (task.status !== "failed" && task.status !== "cancelled") {
			throw new Error(
				`Can only requeue failed/cancelled tasks (got: ${task.status})`,
			);
		}

		const update: Record<string, unknown> = {
			status: "pending",
			scheduledFor: sql`NOW()`,
			workerId: null,
			startedAt: null,
			completedAt: null,
			failedAt: null,
			errorMessage: null,
			updatedAt: sql`NOW()`,
		};
		if (input.resetRetry) {
			update.retryCount = 0;
		}

		await db
			.update(taskQueue)
			.set(update as unknown as Partial<typeof taskQueue.$inferInsert>)
			.where(eq(taskQueue.id, input.taskId));

		return { success: true };
	});

export const reschedule = superadminProcedure
	.input(
		z.object({
			taskId: z.string().min(1),
			scheduledFor: z.coerce.date(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const [task] = await db
			.select({ status: taskQueue.status })
			.from(taskQueue)
			.where(eq(taskQueue.id, input.taskId))
			.limit(1);

		if (!task) {
			throw new Error(`Task not found: ${input.taskId}`);
		}
		if (task.status !== "pending") {
			throw new Error(
				`Can only reschedule pending tasks (got: ${task.status})`,
			);
		}

		await db
			.update(taskQueue)
			.set({
				scheduledFor: input.scheduledFor,
				updatedAt: sql`NOW()`,
			})
			.where(eq(taskQueue.id, input.taskId));

		return { success: true };
	});

export const recoverOrphaned = superadminProcedure.handler(async () => {
	return recoverOrphanedTasks();
});

export const cleanupCompleted = superadminProcedure
	.input(z.object({ daysToKeep: z.number().int().min(1).max(365).default(7) }))
	.handler(async ({ input }) => {
		const deletedCount = await cleanupOldTasks(input.daysToKeep);
		return { deletedCount };
	});
