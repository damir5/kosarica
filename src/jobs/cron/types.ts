/**
 * Cron System Type Definitions
 *
 * Types for the distributed cron scheduler with Postgres coordination.
 */

import type { cronJobs, cronRuns } from "@/db/schema";

/**
 * Status values for cron runs
 */
export type CronRunStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "skipped";

/**
 * Task to be enqueued by a cron job handler
 */
export interface TaskToEnqueue {
	type: string;
	payload?: Record<string, unknown>;
	idempotencyKey?: string;
}

/**
 * Context provided to cron job handlers during execution
 */
export interface CronExecutionContext {
	jobId: string;
	runId: bigint;
	scheduledFor: Date;
	isManual: boolean;
	payload?: Record<string, unknown>;
}

/**
 * Handler interface for cron jobs
 * Handlers return tasks to be enqueued rather than executing directly
 */
export interface CronJobHandler {
	execute(context: CronExecutionContext): Promise<TaskToEnqueue[]>;
}

/**
 * Configuration for registering a cron job
 */
export interface CronJobConfig {
	id: string;
	name: string;
	cronExpression: string;
	timezone?: string;
	taskType: string;
	taskPayload?: Record<string, unknown>;
	handler?: CronJobHandler;
}

/**
 * Registered job with handler in memory
 */
export interface RegisteredJob extends CronJobConfig {
	handler?: CronJobHandler;
}

/**
 * Database row type for cron_jobs table
 */
export type CronJobRow = typeof cronJobs.$inferSelect;

/**
 * Database row type for cron_runs table
 */
export type CronRunRow = typeof cronRuns.$inferSelect;

/**
 * Result of claiming due jobs
 */
export interface ClaimedJob {
	job: CronJobRow;
	scheduledFor: Date;
}

/**
 * Scheduler health information
 */
export interface SchedulerHealth {
	isLeader: boolean;
	lastTickAt: Date | null;
	jobCount: number;
	leaderSince: Date | null;
}
