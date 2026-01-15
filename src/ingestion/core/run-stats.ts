import { eq, sql, and } from "drizzle-orm";
import { ingestionRuns, ingestionFiles } from "@/db/schema";
import type { Database } from "@/db";

/**
 * Initialize run stats when a run starts.
 * Sets status to "running" and records startedAt.
 */
export async function initializeRunStats(
	db: Database,
	runId: string,
): Promise<void> {
	await db
		.update(ingestionRuns)
		.set({
			status: "running",
			startedAt: new Date(),
			// Reset all counters to 0
			totalFiles: 0,
			processedFiles: 0,
			totalEntries: 0,
			processedEntries: 0,
			errorCount: 0,
		})
		.where(eq(ingestionRuns.id, runId));
}

/**
 * Record total files discovered for a run.
 * Called when discovery completes.
 */
export async function recordTotalFiles(
	db: Database,
	runId: string,
	count: number,
): Promise<void> {
	await db
		.update(ingestionRuns)
		.set({ totalFiles: count })
		.where(eq(ingestionRuns.id, runId));
}

/**
 * Increment processed files count.
 * Called when a file completes processing.
 */
export async function incrementProcessedFiles(
	db: Database,
	runId: string,
): Promise<void> {
	await db
		.update(ingestionRuns)
		.set({
			processedFiles: sql`${ingestionRuns.processedFiles} + 1`,
		})
		.where(eq(ingestionRuns.id, runId));
}

/**
 * Increment processed entries count.
 * Called when entries are persisted.
 */
export async function incrementProcessedEntries(
	db: Database,
	runId: string,
	count: number,
): Promise<void> {
	await db
		.update(ingestionRuns)
		.set({
			processedEntries: sql`${ingestionRuns.processedEntries} + ${count}`,
		})
		.where(eq(ingestionRuns.id, runId));
}

/**
 * Increment error count.
 * Called when an error occurs.
 */
export async function incrementErrorCount(
	db: Database,
	runId: string,
	count: number = 1,
): Promise<void> {
	await db
		.update(ingestionRuns)
		.set({
			errorCount: sql`${ingestionRuns.errorCount} + ${count}`,
		})
		.where(eq(ingestionRuns.id, runId));
}

/**
 * Check if run is complete and update status if so.
 * Run is complete when all files are processed.
 */
export async function checkAndUpdateRunCompletion(
	db: Database,
	runId: string,
): Promise<void> {
	// Get current run state
	const [run] = await db
		.select()
		.from(ingestionRuns)
		.where(eq(ingestionRuns.id, runId))
		.limit(1);

	if (!run) return;

	// Check if all files processed
	if (
		run.totalFiles !== null &&
		run.totalFiles > 0 &&
		run.processedFiles !== null &&
		run.processedFiles >= run.totalFiles
	) {
		// Check for any failed files
		const [failedFileCount] = await db
			.select({ count: sql<number>`count(*)` })
			.from(ingestionFiles)
			.where(
				and(
					eq(ingestionFiles.runId, runId),
					eq(ingestionFiles.status, "failed"),
				),
			);

		const finalStatus = failedFileCount.count > 0 ? "failed" : "completed";

		await db
			.update(ingestionRuns)
			.set({
				status: finalStatus,
				completedAt: new Date(),
			})
			.where(eq(ingestionRuns.id, runId));

		console.log(
			`[run_stats] Run ${runId} marked as ${finalStatus}: ${run.processedFiles}/${run.totalFiles} files, ${run.processedEntries}/${run.totalEntries} entries, ${run.errorCount} errors`,
		);
	}
}

/**
 * Mark run as failed.
 * Called when a critical error occurs.
 */
export async function markRunFailed(
	db: Database,
	runId: string,
	errorMessage?: string,
): Promise<void> {
	await db
		.update(ingestionRuns)
		.set({
			status: "failed",
			completedAt: new Date(),
			metadata: errorMessage ? JSON.stringify({ error: errorMessage }) : undefined,
		})
		.where(eq(ingestionRuns.id, runId));
}
