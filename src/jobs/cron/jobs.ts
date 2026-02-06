/**
 * Cron Job Registration
 *
 * Registers all cron jobs with the scheduler.
 * Jobs are registered in memory at startup, then synced to the database
 * when the instance becomes the leader.
 */

import { barcodeMatchingHandler } from "./handlers/barcode-matching";
import { dailyIngestionHandler } from "./handlers/daily-ingestion";
import { knowledgeMatchingHandler } from "./handlers/knowledge-matching";
import { semanticMatchingHandler } from "./handlers/semantic-matching";
import { tempCleanupHandler } from "./handlers/temp-cleanup";
import { trigramMatchingHandler } from "./handlers/trigram-matching";
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

	// Knowledge catalog matching before barcode matching
	registerCronJob({
		id: "knowledge-matching",
		name: "Knowledge Product Matching",
		cronExpression: "30 8 * * *", // 8:30 AM UTC, before barcode at 9 AM
		timezone: "UTC",
		taskType: "matching",
		handler: knowledgeMatchingHandler,
	});

	// Barcode matching after daily ingestion window
	registerCronJob({
		id: "barcode-matching",
		name: "Barcode Product Matching",
		cronExpression: "0 9 * * *",
		timezone: "UTC",
		taskType: "cleanup",
		handler: barcodeMatchingHandler,
	});

	// Trigram matching after barcode matching
	registerCronJob({
		id: "trigram-matching",
		name: "Trigram Product Matching",
		cronExpression: "0 10 * * *", // 10 AM UTC, after barcode at 9 AM
		timezone: "UTC",
		taskType: "matching",
		handler: trigramMatchingHandler,
	});

	// Semantic matching after trigram matching
	registerCronJob({
		id: "semantic-matching",
		name: "Semantic Product Matching",
		cronExpression: "0 11 * * *", // 11 AM UTC, after trigram at 10 AM
		timezone: "UTC",
		taskType: "matching",
		handler: semanticMatchingHandler,
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
