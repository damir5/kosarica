/**
 * Cron Utilities
 *
 * Helper functions for cron expression parsing and idempotency key generation.
 */

import { type CronExpression, CronExpressionParser } from "cron-parser";

/**
 * Parse a cron expression and validate it
 */
export function parseCronExpression(
	expression: string,
	timezone = "UTC",
): CronExpression {
	return CronExpressionParser.parse(expression, {
		tz: timezone,
	});
}

/**
 * Get the next run time for a cron expression
 *
 * @param expression - Cron expression (e.g., "0 6 * * *")
 * @param timezone - Timezone for the cron schedule
 * @param from - Reference date to calculate next run from
 * @returns Next run time as Date
 */
export function getNextRun(
	expression: string,
	timezone = "UTC",
	from: Date = new Date(),
): Date {
	const interval = CronExpressionParser.parse(expression, {
		tz: timezone,
		currentDate: from,
	});
	return interval.next().toDate();
}

/**
 * Get the previous scheduled run time for a cron expression
 * Useful for calculating scheduledFor when a job was missed
 *
 * @param expression - Cron expression
 * @param timezone - Timezone for the cron schedule
 * @param from - Reference date to calculate previous run from
 * @returns Previous run time as Date
 */
export function getPreviousRun(
	expression: string,
	timezone = "UTC",
	from: Date = new Date(),
): Date {
	const interval = CronExpressionParser.parse(expression, {
		tz: timezone,
		currentDate: from,
	});
	return interval.prev().toDate();
}

/**
 * Generate an idempotency key for a cron run
 *
 * Format: "cron:{job_id}:{scheduled_for_iso}"
 * Example: "cron:daily-ingestion:2024-01-15T06:00:00.000Z"
 *
 * @param jobId - The job identifier
 * @param scheduledFor - The scheduled execution time
 * @returns Unique idempotency key
 */
export function generateIdempotencyKey(
	jobId: string,
	scheduledFor: Date,
): string {
	return `cron:${jobId}:${scheduledFor.toISOString()}`;
}

/**
 * Generate an idempotency key for a manual trigger
 *
 * Format: "manual:{job_id}:{timestamp}"
 * Manual triggers use a different prefix so they can run
 * concurrently with scheduled runs.
 *
 * @param jobId - The job identifier
 * @returns Unique idempotency key for manual trigger
 */
export function generateManualIdempotencyKey(jobId: string): string {
	return `manual:${jobId}:${Date.now()}`;
}

/**
 * Check if a connection error occurred
 * Used to detect when we've lost the advisory lock
 */
export function isConnectionError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const message = error.message.toLowerCase();
	const connectionErrorPatterns = [
		"connection",
		"econnrefused",
		"econnreset",
		"etimedout",
		"socket",
		"terminated",
		"closed",
	];

	return connectionErrorPatterns.some((pattern) => message.includes(pattern));
}
