/**
 * Cron Job Registration
 *
 * Registers all cron jobs with the scheduler.
 * Jobs are registered in memory at startup, then synced to the database
 * when the instance becomes the leader.
 */

import { dailyIngestionHandler } from "./handlers/daily-ingestion";
import { semanticClusteringHandler } from "./handlers/semantic-clustering";
import { tempCleanupHandler } from "./handlers/temp-cleanup";
import { registerCronJob } from "./registry";

/**
 * Register all cron jobs
 *
 * This function is called at application startup to populate
 * the in-memory registry. No database access happens here.
 */
export function registerAllCronJobs(): void {
	// Daily price ingestion at 6 AM UTC
	registerCronJob({
		id: "daily-ingestion",
		name: "Daily Price Ingestion",
		cronExpression: "0 6 * * *",
		timezone: "UTC",
		taskType: "ingestion",
		handler: dailyIngestionHandler,
	});

	// Temporary storage cleanup every 6 hours
	registerCronJob({
		id: "temp-cleanup",
		name: "Temporary Storage Cleanup",
		cronExpression: "0 */6 * * *", // Every 6 hours
		timezone: "UTC",
		taskType: "cleanup",
		handler: tempCleanupHandler,
	});

	// Semantic clustering replaces legacy knowledge/barcode/trigram/semantic matching.
	registerCronJob({
		id: "semantic-clustering",
		name: "Semantic Product Clustering",
		cronExpression: "30 9 * * *", // 9:30 AM UTC after ingestion
		timezone: "UTC",
		taskType: "matching",
		handler: semanticClusteringHandler,
	});

	// Add more jobs here as needed:
	//
	// registerCronJob({
	//   id: "weekly-cleanup",
	//   name: "Weekly Data Cleanup",
	//   cronExpression: "0 2 * * 0", // 2 AM every Sunday
	//   timezone: "UTC",
	//   taskType: "cleanup",
	//   handler: weeklyCleanupHandler,
	// });
}
