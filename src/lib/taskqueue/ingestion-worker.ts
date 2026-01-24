import { rerunIngestion, scheduleIngestion } from "@/lib/go-service-client";
import type { TaskType } from "./index";

export function createIngestionWorker() {
	const worker = new TaskQueueWorker({
		workerId: "node-ingestion-worker-1",
		taskTypes: ["ingestion", "rerun"] as TaskType[],
		maxTasks: 5,
		pollDelay: 5000,
	});

	worker.registerHandler("ingestion" as TaskType, async (task) => {
		const payload = task.payload as { chainId: string; targetDate?: string };

		console.log(`[INGESTION] Starting ingestion for chain: ${payload.chainId}`);

		const { id } = await scheduleIngestion(payload.chainId, payload.targetDate);

		if (id) {
			console.log(`[INGESTION] Scheduled ingestion task: ${id}`);
		} else {
			throw new Error("Failed to schedule ingestion task");
		}
	});

	worker.registerHandler("rerun" as TaskType, async (task) => {
		const payload = task.payload as { runId: string };

		console.log(`[INGESTION] Rerunning ingestion: ${payload.runId}`);

		await rerunIngestion(payload.runId);
	});

	return worker;
}

export async function startWorker() {
	const worker = createIngestionWorker();
	await worker.start();
}

export async function startWorker() {
	const worker = createIngestionWorker();
	await worker.start();
}
