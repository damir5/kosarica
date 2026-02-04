/**
 * Temporary Storage Cleanup Cron Handler
 *
 * Automatically cleans up old temporary files that exceed the retention period.
 */

import { cleanupTempDirs, getTempStorageConfig } from "@/lib/storage/temp";
import { createLogger } from "@/utils/logger";
import type { CronExecutionContext, CronJobHandler } from "../types";

const log = createLogger("temp-cleanup");

/**
 * Temporary storage cleanup handler implementation
 *
 * Removes temp directories older than TEMP_FILE_RETENTION_HOURS.
 * Runs as a synchronous task (no additional tasks enqueued).
 */
export const tempCleanupHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		log.info("Starting temporary storage cleanup", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
			isManual: context.isManual,
		});

		const config = getTempStorageConfig();
		log.info("Cleanup configuration", {
			basePath: config.basePath,
			retentionHours: config.retentionHours,
		});

		try {
			const cleaned = await cleanupTempDirs();

			if (cleaned.length === 0) {
				log.info("No temporary directories needed cleanup", {
					runId: context.runId,
				});
			} else {
				const totalSize = cleaned.reduce((sum, dir) => sum + dir.sizeBytes, 0);
				const sizeFormatted = formatSize(totalSize);

				log.info("Cleaned up temporary directories", {
					runId: context.runId,
					count: cleaned.length,
					totalSizeBytes: totalSize,
					totalSize: sizeFormatted,
					directories: cleaned.map((d) => d.name),
				});
			}
		} catch (error) {
			log.error(
				"Failed to cleanup temporary storage",
				{ runId: context.runId },
				error,
			);
			throw error;
		}

		// This job doesn't enqueue additional tasks
		return [];
	},
};

/**
 * Format bytes as human-readable size.
 */
function formatSize(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(1)} ${units[unitIndex]}`;
}
