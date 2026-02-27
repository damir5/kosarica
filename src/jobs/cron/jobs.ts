/**
 * Cron Job Registration
 *
 * Registers all cron jobs with the scheduler.
 * Jobs are registered in memory at startup, then synced to the database
 * when the instance becomes the leader.
 */

import { barcodeAnchorBatchHandler } from "./handlers/barcode-anchor-batch";
import { conflictCheckHandler } from "./handlers/conflict-check";
import { dailyIngestionHandler } from "./handlers/daily-ingestion";
import { featureMatchBatchHandler } from "./handlers/feature-match-batch";
import { llmEndpointHealthCheckHandler } from "./handlers/llm-endpoint-health-check";
import { publishedPriceProbeHandler } from "./handlers/published-price-probe";
import { refreshPricesCurrentHandler } from "./handlers/refresh-prices-current";
import { semanticClusteringHandler } from "./handlers/semantic-clustering";
import { tempCleanupHandler } from "./handlers/temp-cleanup";
import { triageQueueRefreshHandler } from "./handlers/triage-queue-refresh";
import { registerCronJob } from "./registry";

/**
 * Register all cron jobs
 *
 * This function is called at application startup to populate
 * the in-memory registry. No database access happens here.
 */
export function registerAllCronJobs(): void {
	// Weekday ingestion at 2:00 AM Europe/Zagreb so downstream refresh
	// can complete before users start browsing around 5:00 AM local time.
	registerCronJob({
		id: "daily-ingestion",
		name: "Daily Price Ingestion",
		cronExpression: "0 2 * * 1-5",
		timezone: "Europe/Zagreb",
		taskType: "ingestion",
		handler: dailyIngestionHandler,
	});

	// Re-probe late publishers every 15 minutes in the morning window.
	registerCronJob({
		id: "published-price-probe",
		name: "Published Price Probe",
		cronExpression: "*/15 2-8 * * 1-5",
		timezone: "Europe/Zagreb",
		taskType: "ingestion",
		handler: publishedPriceProbeHandler,
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

	registerCronJob({
		id: "barcode-anchor-batch",
		name: "Barcode Anchor Batch",
		cronExpression: "0 */2 * * *", // Every 2 hours
		timezone: "UTC",
		taskType: "barcode-anchor",
		handler: barcodeAnchorBatchHandler,
	});

	registerCronJob({
		id: "llm-endpoint-health-check",
		name: "LLM Endpoint Health Check",
		cronExpression: "*/5 * * * *",
		timezone: "UTC",
		taskType: "matching",
		handler: llmEndpointHealthCheckHandler,
	});

	registerCronJob({
		id: "feature-match-batch",
		name: "Feature Match Batch",
		cronExpression: "15 */4 * * *", // Every 4 hours
		timezone: "UTC",
		taskType: "matching",
		handler: featureMatchBatchHandler,
	});

	registerCronJob({
		id: "conflict-check",
		name: "Catalog Conflict Check",
		cronExpression: "0 5 * * *", // Daily at 5 AM UTC
		timezone: "UTC",
		taskType: "matching",
		handler: conflictCheckHandler,
	});

	registerCronJob({
		id: "triage-queue-refresh",
		name: "Barcode Triage Queue Refresh",
		cronExpression: "*/15 * * * *", // Every 15 minutes
		timezone: "UTC",
		taskType: "matching",
		handler: triageQueueRefreshHandler,
	});

	// Weekday refresh at 4:15 AM Europe/Zagreb after ingestion.
	registerCronJob({
		id: "refresh-prices-current",
		name: "Refresh Current Prices Table",
		cronExpression: "15 4 * * 1-5",
		timezone: "Europe/Zagreb",
		taskType: "clickhouse",
		handler: refreshPricesCurrentHandler,
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
