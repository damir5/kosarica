import {
	type ClaimedTask,
	claimTasks,
	completeTask,
	failTask,
	startProcessing,
	type TaskType,
} from "./index";

export interface WorkerConfig {
	workerId: string;
	taskTypes?: TaskType[];
	maxTasks?: number;
	pollDelay?: number;
}

export class TaskQueueWorker {
	private config: Required<WorkerConfig>;
	private stopSignal: boolean = false;
	private handlers: Map<TaskType, (task: ClaimedTask) => Promise<void>> =
		new Map();
	private runningTasks: Set<Promise<void>> = new Set();

	constructor(config: WorkerConfig) {
		this.config = {
			workerId: config.workerId,
			taskTypes: config.taskTypes ?? [],
			maxTasks: config.maxTasks ?? 10,
			pollDelay: config.pollDelay ?? 5000,
		};
	}

	registerHandler(
		taskType: TaskType,
		handler: (task: ClaimedTask) => Promise<void>,
	) {
		this.handlers.set(taskType, handler);
	}

	async start() {
		console.log(
			`[WORKER] Starting worker: ${this.config.workerId} (types: ${this.config.taskTypes?.join(", ")})`,
		);

		while (!this.stopSignal) {
			try {
				await this.processTasks();
			} catch (error) {
				console.error("[WORKER] Error processing tasks:", error);
			}

			await this.sleep(this.config.pollDelay);
		}

		console.log(
			`[WORKER] Worker ${this.config.workerId} waiting for in-flight tasks...`,
		);

		await Promise.allSettled(this.runningTasks);

		console.log(`[WORKER] Worker ${this.config.workerId} stopped`);
	}

	async stop() {
		console.log(`[WORKER] Stopping worker ${this.config.workerId}`);
		this.stopSignal = true;
	}

	private async processTasks() {
		const tasks = await claimTasks(
			this.config.workerId,
			this.config.taskTypes,
			this.config.maxTasks,
		);

		if (tasks.length === 0) {
			return;
		}

		console.log(
			`[WORKER] Worker ${this.config.workerId} claimed ${tasks.length} tasks`,
		);

		for (const task of tasks) {
			await this.processTask(task);
		}
	}

	private async processTask(task: ClaimedTask) {
		if (this.stopSignal) {
			console.log(`[WORKER] Worker stopping, skipping task ${task.id}`);
			return;
		}

		const handler = this.handlers.get(task.task_type as TaskType);

		if (!handler) {
			console.warn(`[WARN] No handler for task type: ${task.task_type}`);
			await failTask(task.id, "No handler registered", false);
			return;
		}

		console.log(
			`[WORKER] Processing task ${task.id} (type: ${task.task_type})`,
		);

		const executeTask = async () => {
			try {
				await startProcessing(task.id);

				const TASK_TIMEOUT = 30 * 60 * 1000;
				await Promise.race([
					handler(task),
					new Promise<void>((_, reject) =>
						setTimeout(
							() => reject(new Error("Task execution timeout")),
							TASK_TIMEOUT,
						),
					),
				]);
				await completeTask(task.id);
				console.log(`[WORKER] Completed task ${task.id}`);
			} catch (error) {
				console.error(`[WORKER] Task ${task.id} failed:`, error);
				await failTask(
					task.id,
					error instanceof Error ? error.message : String(error),
					true,
				);
			}
		};

		this.runningTasks.add(executeTask());

		try {
			await executeTask();
		} finally {
			this.runningTasks.delete(executeTask());
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
