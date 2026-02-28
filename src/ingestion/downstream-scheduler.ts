import { sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { scheduleTask } from "@/lib/taskqueue";
import { createLogger } from "@/utils/logger";

const log = createLogger("daily-ingestion");

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
			AND (
				status IN ('claimed', 'processing')
				OR (status = 'pending' AND scheduled_for <= NOW())
			)
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

	const clickHouseAlreadyQueued = await hasQueuedClickHouseSyncTask();
	if (clickHouseAlreadyQueued) {
		return;
	}

	await scheduleTask({
		taskType: "clickhouse",
		priority: 12,
		payload: {
			type: "clickhouseSync",
			mode: "missing",
		},
	});

	log.info("Queued ClickHouse sync after scheduled ingestion round", {
		targetDate,
	});
}
