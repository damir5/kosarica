import type {
	BarcodeAnchorTaskPayload,
	CategorizeTaskPayload,
	CleanupTaskPayload,
	ClickHouseSyncTaskPayload,
	IngestionTaskPayload,
	RerunTaskPayload,
	SemanticClusteringListwiseTaskPayload,
	SemanticClusteringPairwiseTaskPayload,
	SemanticClusteringUnifiedTaskPayload,
} from "@/db/jsonb-schemas";
import {
	loadAllToClickHouse,
	loadMissingToClickHouse,
} from "@/ingestion/clickhouse-sync";
import {
	refreshPricesCurrentForAllChains,
	refreshPricesCurrentForChains,
} from "@/ingestion/clickhouse-current-refresh";
import { scheduleDailyIngestionDownstream } from "@/ingestion/downstream-scheduler";
import { rerunIngestionRun, runIngestion } from "@/ingestion/pipeline";
import { processBarcodeClusters } from "@/lib/barcode-anchoring";
import {
	backfillUncategorizedItems,
	categorizeRunItems,
} from "@/lib/categorization";
import {
	runListwiseSemanticClustering,
	runUnifiedMatching,
} from "@/lib/semantic-clustering";
import { createLogger } from "@/utils/logger";
import { scheduleTask } from "./index";
import { TaskQueueWorker } from "./worker";

const log = createLogger("matching");

function parsePositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
}

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
	const defaultMaxTasks = parsePositiveIntEnv("WORKER_MAX_TASKS", 8);
	const defaultPollDelay = parsePositiveIntEnv("WORKER_POLL_DELAY_MS", 2000);

	const worker = new TaskQueueWorker({
		workerId,
		taskTypes: [
			"ingestion",
			"rerun",
			"cleanup",
			"clickhouse",
			"categorize",
			"barcode-anchor",
			"matching",
		],
		maxTasks: options?.maxTasks ?? defaultMaxTasks,
		pollDelay: options?.pollDelay ?? defaultPollDelay,
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
					force: payload.force ?? false,
					source: payload.source ?? "worker",
				},
			});
		}
		if (result.status === "failed") {
			throw new Error(`Ingestion failed for run ${result.runId}`);
		}
		await scheduleDailyIngestionDownstream({
			taskId: task.id,
			targetDate: payload.targetDate,
			source: payload.source ?? "worker",
		});
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
			const syncResult = await loadAllToClickHouse();
			await refreshPricesCurrentForAllChains();
			log.info("ClickHouse full sync completed", {
				taskId: task.id,
				importedFiles: syncResult.imported,
				importedChains: syncResult.importedChains.length,
			});
			return;
		}
		const syncResult = await loadMissingToClickHouse();
		if (syncResult.importedChains.length > 0) {
			await refreshPricesCurrentForChains(syncResult.importedChains);
		}
		log.info("ClickHouse incremental sync completed", {
			taskId: task.id,
			importedFiles: syncResult.imported,
			importedChains: syncResult.importedChains.length,
			pendingFiles: syncResult.pending,
		});
	});

	worker.registerHandler("categorize", async (task) => {
		const payload = task.payload as CategorizeTaskPayload;
		if (payload.type !== "categorize") {
			throw new Error("Invalid payload for categorize task");
		}
		if (payload.runId && payload.chainSlug) {
			await categorizeRunItems(payload.runId, payload.chainSlug);
			return;
		}
		await backfillUncategorizedItems({
			chainSlug: payload.chainSlug,
			batchSize: payload.batchSize,
			maxBatches: payload.maxBatches,
			maxRuntimeMinutes: payload.maxRuntimeMinutes,
		});
	});

	worker.registerHandler("barcode-anchor", async (task) => {
		const payload = task.payload as BarcodeAnchorTaskPayload;
		if (payload.type !== "barcodeAnchor") {
			throw new Error("Invalid payload for barcode-anchor task");
		}
		await processBarcodeClusters({
			limit: payload.limit,
			minChains: payload.minChains,
			dryRun: payload.dryRun ?? false,
			createdBy: "system",
		});
	});

	worker.registerHandler("matching", async (task) => {
		const payload = task.payload as
			| SemanticClusteringPairwiseTaskPayload
			| SemanticClusteringListwiseTaskPayload
			| SemanticClusteringUnifiedTaskPayload;

		if (payload.type === "semanticClusteringUnified") {
			await runUnifiedMatching({
				limit: payload.limit,
				dryRun: payload.dryRun,
				minPrimaryConfidence: payload.minPrimaryConfidence,
				maxGroupSize: payload.maxGroupSize,
				groupsPerCall: payload.groupsPerCall,
				blocking: {
					barcodeLimit: payload.barcodeLimit,
					barcodeMinChains: payload.barcodeMinChains,
					deterministicLimit: payload.deterministicLimit,
					embeddingLimit: payload.embeddingLimit,
					lexicalLimit: payload.lexicalLimit,
				},
			});
			return;
		}

		if (payload.type === "semanticClusteringListwise") {
			await runListwiseSemanticClustering({
				limit: payload.limit,
				minChains: payload.minChains,
				dryRun: payload.dryRun,
				minPrimaryConfidence: payload.minPrimaryConfidence,
			});
			return;
		}

		if (payload.type !== "semanticClusteringPairwise") {
			throw new Error("Invalid payload for matching task");
		}

		// Pairwise pipeline is currently disabled (legacy + inefficient).
		// We keep the payload type for backwards compatibility with existing tasks,
		// but avoid doing any work here.
		log.warn("Skipping pairwise semantic clustering task (disabled)", {
			taskId: task.id,
		});
		return;
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
