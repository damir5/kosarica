/* eslint-disable no-console */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { countUncategorizedItems } from "@/lib/categorization";
import { scheduleTask } from "@/lib/taskqueue";

function loadRuntimeEnv(): void {
	// Staging runs with real env; local runs often rely on dotenv.
	if (process.env.DATABASE_URL) return;

	const envCandidates: string[] = [];
	if (process.env.NODE_ENV) {
		envCandidates.push(`.env.${process.env.NODE_ENV}.local`);
		envCandidates.push(`.env.${process.env.NODE_ENV}`);
	}
	envCandidates.push(
		".env.development.local",
		".env.local",
		".env.test",
		".env.development",
		".env",
	);

	for (const file of envCandidates) {
		if (!existsSync(file)) continue;
		loadDotenv({ path: file });
	}
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
}

function parseArgs(argv: string[]): {
	chainSlug: string | undefined;
	batchSize: number;
	maxBatches: number;
	maxRuntimeMinutes: number;
} {
	let chainSlug: string | undefined;
	let batchSize = parsePositiveInt(process.env.CAT_BATCH_SIZE, 200);
	let maxBatches = parsePositiveInt(process.env.CAT_MAX_BATCHES, 10_000);
	let maxRuntimeMinutes = parsePositiveInt(process.env.CAT_MAX_RUNTIME_MINUTES, 600);

	for (const arg of argv) {
		if (arg.startsWith("--chain=")) chainSlug = arg.split("=", 2)[1] ?? chainSlug;
		if (arg.startsWith("--batch-size=")) {
			batchSize = parsePositiveInt(arg.split("=", 2)[1], batchSize);
		}
		if (arg.startsWith("--max-batches=")) {
			maxBatches = parsePositiveInt(arg.split("=", 2)[1], maxBatches);
		}
		if (arg.startsWith("--max-runtime-minutes=")) {
			maxRuntimeMinutes = parsePositiveInt(
				arg.split("=", 2)[1],
				maxRuntimeMinutes,
			);
		}
	}

	batchSize = Math.min(5000, Math.max(1, batchSize));
	maxBatches = Math.min(20_000, Math.max(1, maxBatches));
	maxRuntimeMinutes = Math.min(24 * 60, Math.max(1, maxRuntimeMinutes));

	return {
		chainSlug,
		batchSize,
		maxBatches,
		maxRuntimeMinutes,
	};
}

async function main(): Promise<void> {
	loadRuntimeEnv();

	const { chainSlug, batchSize, maxBatches, maxRuntimeMinutes } = parseArgs(
		process.argv.slice(2),
	);

	const pendingBefore = await countUncategorizedItems();
	const task = await scheduleTask({
		taskType: "categorize",
		payload: {
			type: "categorize",
			chainSlug,
			batchSize,
			maxBatches,
			maxRuntimeMinutes,
		},
		priority: 0,
	});

	console.log(
		JSON.stringify(
			{
				scheduledAt: new Date().toISOString(),
				taskId: task.id,
				chainSlug: chainSlug ?? null,
				batchSize,
				maxBatches,
				maxRuntimeMinutes,
				pendingBefore,
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

