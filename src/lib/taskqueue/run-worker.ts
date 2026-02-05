import type {
	CleanupTaskPayload,
	ClickHouseSyncTaskPayload,
	IngestionTaskPayload,
	RerunTaskPayload,
} from "@/db/jsonb-schemas";
import {
	loadAllToClickHouse,
	loadMissingToClickHouse,
} from "@/ingestion/clickhouse-sync";
import { rerunIngestionRun, runIngestion } from "@/ingestion/pipeline";
import { scheduleTask } from "./index";
import { TaskQueueWorker } from "./worker";

export function createTaskQueueWorker(options?: {
	workerId?: string;
	maxTasks?: number;
	pollDelay?: number;
}): TaskQueueWorker {
	const workerId =
		options?.workerId ??
		process.env.WORKER_ID ??
		process.env.HOSTNAME ??
		`node-${process.pid}`;

	const worker = new TaskQueueWorker({
		workerId,
		taskTypes: ["ingestion", "rerun", "cleanup", "clickhouse"],
		maxTasks: options?.maxTasks ?? 5,
		pollDelay: options?.pollDelay ?? 5000,
	});

	worker.registerHandler("ingestion", async (task) => {
		const payload = task.payload as IngestionTaskPayload;
		const result = await runIngestion({
			chainSlug: payload.chainSlug,
			targetDate: payload.targetDate,
			force: payload.force,
			source: payload.source ?? "worker",
			taskId: task.id,
		});
		if (result.retryAt) {
			await scheduleTask({
				taskType: "ingestion",
				scheduledFor: new Date(result.retryAt),
				payload: {
					type: "ingestion",
					chainSlug: payload.chainSlug,
					targetDate: payload.targetDate,
					force: true,
					source: payload.source ?? "worker",
				},
			});
		}
		if (result.status === "failed") {
			throw new Error(`Ingestion failed for run ${result.runId}`);
		}
	});

	worker.registerHandler("rerun", async (task) => {
		const payload = task.payload as RerunTaskPayload;
		const result = await rerunIngestionRun(
			payload.originalRunId,
			payload.rerunType,
			payload.targetId,
			task.id,
		);
		if (result.status === "failed") {
			throw new Error(`Rerun failed for run ${result.runId}`);
		}
	});

	worker.registerHandler("cleanup", async (task) => {
		const payload = task.payload as CleanupTaskPayload;
		// Reuse the existing admin cleanup helper (DB-only)
		const { cleanupOldTasks } = await import("./index");
		await cleanupOldTasks(payload.daysToKeep ?? 7);
	});

	worker.registerHandler("clickhouse", async (task) => {
		const payload = task.payload as ClickHouseSyncTaskPayload;
		if (payload.type !== "clickhouseSync") {
			throw new Error("Invalid payload for clickhouse task");
		}
		if (payload.mode === "all") {
			await loadAllToClickHouse();
			return;
		}
		await loadMissingToClickHouse();
	});

	return worker;
}

export async function startWorker(options?: {
	workerId?: string;
	maxTasks?: number;
	pollDelay?: number;
	background?: boolean;
}): Promise<TaskQueueWorker> {
	const worker = createTaskQueueWorker(options);
	if (options?.background) {
		void worker.start();
		return worker;
	}
	await worker.start();
	return worker;
}
