/**
 * Cron System - Public API
 *
 * Postgres-coordinated distributed cron scheduler using node-cron for tick scheduling.
 *
 * Architecture:
 * - node-cron schedules periodic "tick" checks (every 10 seconds)
 * - PostgreSQL advisory locks ensure only one instance executes jobs
 * - Job definitions stored in cron_jobs table
 * - Execution history stored in cron_runs table with idempotency keys
 *
 * Usage:
 * 1. Register job handlers at startup with registerCronJob()
 * 2. Start the tick loop with startTickLoop()
 * 3. The leader instance will sync jobs to DB and execute them
 */

// Executor
export {
	claimDueJobs,
	executeJob,
	executeJobManually,
	recoverStuckRuns,
} from "./executor";
// Job Registration
export { registerAllCronJobs } from "./jobs";
// Registry
export {
	clearRegistry,
	getRegisteredJob,
	getRegisteredJobs,
	registerCronJob,
	syncJobsToDatabase,
} from "./registry";

// Tick Loop
export {
	getSchedulerHealth,
	isSchedulerLeader,
	releaseLeadership,
	startTickLoop,
	stopTickLoop,
} from "./tick";
// Types
export type {
	ClaimedJob,
	CronExecutionContext,
	CronJobConfig,
	CronJobHandler,
	CronRunStatus,
	RegisteredJob,
	SchedulerHealth,
	TaskToEnqueue,
} from "./types";

// Utilities
export {
	generateIdempotencyKey,
	generateManualIdempotencyKey,
	getNextRun,
	getPreviousRun,
	parseCronExpression,
} from "./utils";
