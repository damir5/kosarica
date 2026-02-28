import { sql } from "drizzle-orm";
import { getDatabase, taskQueue } from "@/db";
import { createLogger } from "@/utils/logger";

const log = createLogger("daily-ingestion");
const DOWNSTREAM_CLICKHOUSE_LOCK_ID = 1952535;

interface ScheduleDailyDownstreamOptions {
	taskId: string;
	targetDate?: string;
	source?: string;
}

function toRows<T>(result: unknown): T[] {
	if (Array.isArray(result)) {
		return result as T[];
	}
	if (
		result &&
		typeof result === "object" &&
		"rows" in result &&
		Array.isArray(result.rows)
	) {
		return result.rows as T[];
	}
	return [];
}

async function hasDueIngestionTasks(
	targetDate: string,
	currentTaskId: string,
): Promise<boolean> {
	const db = getDatabase();
	const result = await db.execute(sql`
		SELECT id
		FROM task_queue
		WHERE task_type = 'ingestion'
			AND payload->>'targetDate' = ${targetDate}
			AND id <> ${currentTaskId}
			AND status = 'pending'
			AND scheduled_for <= NOW()
		LIMIT 1
	`);
	const rows = toRows<{ id: string }>(result);
	return rows.length > 0;
}

async function hasCompletedIngestionData(targetDate: string): Promise<boolean> {
	const db = getDatabase();
	const result = await db.execute(sql`
		SELECT id
		FROM ingestion_runs
		WHERE target_date::date = ${targetDate}::date
			AND status = 'completed'
			AND (COALESCE(total_entries, 0) > 0 OR COALESCE(processed_entries, 0) > 0)
		LIMIT 1
	`);
	const rows = toRows<{ id: string }>(result);
	return rows.length > 0;
}

async function hasQueuedClickHouseSyncTask(): Promise<boolean> {
	const db = getDatabase();
	const result = await db.execute(sql`
		SELECT id
		FROM task_queue
		WHERE task_type = 'clickhouse'
			AND status IN ('pending', 'claimed', 'processing')
			AND payload->>'type' = 'clickhouseSync'
			AND payload->>'mode' = 'missing'
		LIMIT 1
	`);
	const rows = toRows<{ id: string }>(result);
	return rows.length > 0;
}

function isLockAcquired(result: unknown): boolean {
	const rows = toRows<{ acquired?: boolean }>(result);
	return rows[0]?.acquired === true;
}

async function tryQueueClickHouseSyncTask(): Promise<boolean> {
	const db = getDatabase();
	return db.transaction(async (tx) => {
		const lockResult = await tx.execute(sql`
			SELECT pg_try_advisory_xact_lock(${DOWNSTREAM_CLICKHOUSE_LOCK_ID}) AS acquired
		`);
		if (!isLockAcquired(lockResult)) {
			return false;
		}

		const alreadyQueued = await tx.execute(sql`
			SELECT id
			FROM task_queue
			WHERE task_type = 'clickhouse'
				AND status IN ('pending', 'claimed', 'processing')
				AND payload->>'type' = 'clickhouseSync'
				AND payload->>'mode' = 'missing'
			LIMIT 1
		`);
		if (toRows<{ id: string }>(alreadyQueued).length > 0) {
			return false;
		}

		await tx.insert(taskQueue).values({
			taskType: "clickhouse",
			payload: {
				type: "clickhouseSync",
				mode: "missing",
			},
			priority: 12,
			status: "pending",
			scheduledFor: sql`NOW()`,
			maxRetries: 3,
			createdAt: sql`NOW()`,
			updatedAt: sql`NOW()`,
		});

		return true;
	});
}

export async function scheduleDailyIngestionDownstream(
	options: ScheduleDailyDownstreamOptions,
): Promise<void> {
	if (options.source !== "scheduled") {
		return;
	}

	const targetDate = options.targetDate?.trim();
	if (!targetDate) {
		return;
	}

	const hasMoreDueIngestionTasks = await hasDueIngestionTasks(
		targetDate,
		options.taskId,
	);
	if (hasMoreDueIngestionTasks) {
		return;
	}

	const hasAnyData = await hasCompletedIngestionData(targetDate);
	if (!hasAnyData) {
		log.info(
			"Skipping downstream scheduling because no completed ingestion with data exists",
			{ targetDate },
		);
		return;
	}

	if (await hasQueuedClickHouseSyncTask()) {
		return;
	}

	const queued = await tryQueueClickHouseSyncTask();
	if (!queued) {
		return;
	}

	log.info("Queued ClickHouse sync after scheduled ingestion round", {
		targetDate,
	});
}
