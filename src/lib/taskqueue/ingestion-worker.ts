import { rerunIngestion, scheduleIngestion } from "@/lib/go-service-client";
import {
	type ClaimedTask,
	type TaskType,
	claimTasks,
	completeTask,
	failTask,
	startProcessing,
} from "./index";

type TaskHandler = (task: ClaimedTask) => Promise<void>;

interface TaskQueueWorkerOptions {
	workerId: string;
	taskTypes: TaskType[];
	maxTasks: number;
	pollDelay: number;
}

class TaskQueueWorker {
	private workerId: string;
	private taskTypes: TaskType[];
	private maxTasks: number;
	private pollDelay: number;
	private handlers: Map<TaskType, TaskHandler> = new Map();
	private running = false;

	constructor(options: TaskQueueWorkerOptions) {
		this.workerId = options.workerId;
		this.taskTypes = options.taskTypes;
		this.maxTasks = options.maxTasks;
		this.pollDelay = options.pollDelay;
	}

	registerHandler(taskType: TaskType, handler: TaskHandler): void {
		this.handlers.set(taskType, handler);
	}

	async start(): Promise<void> {
		this.running = true;
		console.log(`[WORKER] Starting worker ${this.workerId}`);

		while (this.running) {
			try {
				const tasks = await claimTasks(
					this.workerId,
					this.maxTasks,
					this.taskTypes,
				);

				for (const task of tasks) {
					await this.processTask(task);
				}

				if (tasks.length === 0) {
					await new Promise((resolve) => setTimeout(resolve, this.pollDelay));
				}
			} catch (error) {
				console.error("[WORKER] Error polling tasks:", error);
				await new Promise((resolve) => setTimeout(resolve, this.pollDelay));
			}
		}
	}

	async stop(): Promise<void> {
		this.running = false;
		console.log(`[WORKER] Stopping worker ${this.workerId}`);
	}

	private async processTask(task: ClaimedTask): Promise<void> {
		const handler = this.handlers.get(task.task_type as TaskType);
		if (!handler) {
			console.error(`[WORKER] No handler for task type: ${task.task_type}`);
			await failTask(task.id, `No handler for task type: ${task.task_type}`);
			return;
		}

		try {
			await startProcessing(task.id);
			await handler(task);
			await completeTask(task.id);
			console.log(`[WORKER] Completed task ${task.id}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[WORKER] Task ${task.id} failed:`, message);
			await failTask(task.id, message);
		}
	}
}

export function createIngestionWorker(): TaskQueueWorker {
	const worker = new TaskQueueWorker({
		workerId: "node-ingestion-worker-1",
		taskTypes: ["ingestion", "rerun"] as TaskType[],
		maxTasks: 5,
		pollDelay: 5000,
	});

	worker.registerHandler("ingestion" as TaskType, async (task: ClaimedTask) => {
		const payload = task.payload as { chainId: string; targetDate?: string };

		console.log(`[INGESTION] Starting ingestion for chain: ${payload.chainId}`);

		const { id } = await scheduleIngestion(payload.chainId, payload.targetDate);

		if (id) {
			console.log(`[INGESTION] Scheduled ingestion task: ${id}`);
		} else {
			throw new Error("Failed to schedule ingestion task");
		}
	});

	worker.registerHandler("rerun" as TaskType, async (task: ClaimedTask) => {
		const payload = task.payload as { runId: string };

		console.log(`[INGESTION] Rerunning ingestion: ${payload.runId}`);

		await rerunIngestion(payload.runId);
	});

	return worker;
}

export async function startWorker(): Promise<void> {
	const worker = createIngestionWorker();
	await worker.start();
}
