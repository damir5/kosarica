/**
 * Published Price Probe Cron Handler
 *
 * Periodically re-checks chains that still have zero rows for the target date,
 * so late-publishing chains are picked up automatically without manual reruns.
 */

import { sql } from "drizzle-orm";
import { chainIds } from "@/ingestion/adapters/config";
import { formatDateInTimezone } from "@/ingestion/time";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import type {
	CronExecutionContext,
	CronJobHandler,
	TaskToEnqueue,
} from "../types";

const log = createLogger("daily-ingestion");

interface LatestRunRow {
	chain_slug: string;
	status: string;
	status_type: string | null;
	total_entries: number | string | null;
}

interface ActiveIngestionRow {
	chain_slug: string | null;
}

function toTargetDate(scheduledFor: Date): string {
	return formatDateInTimezone(scheduledFor, "Europe/Zagreb");
}

function getConfiguredChains(): string[] {
	const configured = (process.env.INGESTION_CHAINS || "")
		.split(",")
		.map((chain) => chain.trim())
		.filter(Boolean);
	return configured.length > 0 ? configured : chainIds;
}

export const publishedPriceProbeHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<TaskToEnqueue[]> {
		const db = getDb();
		const chains = getConfiguredChains();
		const targetDate = toTargetDate(context.scheduledFor);

		const latestRunsResult = await db.execute(sql`
			SELECT DISTINCT ON (chain_slug)
				chain_slug,
				status,
				status_type,
				total_entries
			FROM ingestion_runs
			WHERE target_date::date = ${targetDate}::date
			ORDER BY chain_slug, created_at DESC
		`);
		const latestRuns = (
			Array.isArray(latestRunsResult)
				? latestRunsResult
				: (latestRunsResult.rows ?? [])
		) as LatestRunRow[];
		const latestRunByChain = new Map(
			latestRuns.map((row) => [row.chain_slug, row]),
		);

		const activeTasksResult = await db.execute(sql`
			SELECT DISTINCT payload->>'chainSlug' AS chain_slug
			FROM task_queue
			WHERE task_type = 'ingestion'
				AND status IN ('pending', 'claimed', 'processing')
				AND payload->>'targetDate' = ${targetDate}
		`);
		const activeTasks = (
			Array.isArray(activeTasksResult)
				? activeTasksResult
				: (activeTasksResult.rows ?? [])
		) as ActiveIngestionRow[];
		const activeChainSet = new Set(
			activeTasks
				.map((row) => row.chain_slug ?? "")
				.map((value) => value.trim())
				.filter(Boolean),
		);

		const tasks: TaskToEnqueue[] = [];
		for (const chainSlug of chains) {
			if (activeChainSet.has(chainSlug)) {
				continue;
			}

			const latestRun = latestRunByChain.get(chainSlug);
			const totalEntries = Number(latestRun?.total_entries ?? 0);
			const shouldProbe =
				!latestRun ||
				latestRun.status !== "completed" ||
				!Number.isFinite(totalEntries) ||
				totalEntries <= 0 ||
				latestRun.status_type === "source_not_published_yet";

			if (!shouldProbe) {
				continue;
			}

			tasks.push({
				type: "ingestion",
				priority: 12,
				payload: {
					chainSlug,
					targetDate,
					force: true,
					source: "scheduled",
				},
			});
		}

		log.info("Published price probe prepared tasks", {
			runId: context.runId,
			targetDate,
			configuredChains: chains.length,
			queuedChains: tasks.length,
			queuedChainSlugs: tasks.map((task) => task.payload.chainSlug),
		});

		return tasks;
	},
};
