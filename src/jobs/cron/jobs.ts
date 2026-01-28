/**
 * Cron Job Registration
 *
 * Registers all cron jobs with the scheduler.
 * Jobs are registered in memory at startup, then synced to the database
 * when the instance becomes the leader.
 */

import { dailyIngestionHandler } from "./handlers/daily-ingestion";
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

	// Add more jobs here as needed:
	//
	// registerCronJob({
	//   id: "weekly-cleanup",
	//   name: "Weekly Data Cleanup",
	//   cronExpression: "0 2 * * 0", // 2 AM every Sunday
	//   timezone: "UTC",
	//   taskType: "maintenance",
	//   handler: weeklyCleanupHandler,
	// });
}
