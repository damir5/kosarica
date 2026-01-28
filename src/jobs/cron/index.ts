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

// Types
export type {
	CronJobConfig,
	CronJobHandler,
	CronExecutionContext,
	CronRunStatus,
	TaskToEnqueue,
	RegisteredJob,
	ClaimedJob,
	SchedulerHealth,
} from "./types";

// Registry
export {
	registerCronJob,
	getRegisteredJobs,
	getRegisteredJob,
	syncJobsToDatabase,
	clearRegistry,
} from "./registry";

// Executor
export {
	claimDueJobs,
	executeJob,
	executeJobManually,
	recoverStuckRuns,
} from "./executor";

// Tick Loop
export {
	startTickLoop,
	stopTickLoop,
	getSchedulerHealth,
	isSchedulerLeader,
	releaseLeadership,
} from "./tick";

// Job Registration
export { registerAllCronJobs } from "./jobs";

// Utilities
export {
	getNextRun,
	getPreviousRun,
	generateIdempotencyKey,
	generateManualIdempotencyKey,
	parseCronExpression,
} from "./utils";
