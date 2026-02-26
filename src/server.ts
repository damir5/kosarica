/**
 * Server entry point for TanStack Start with Node.js
 *
 * Handles HTTP requests via TanStack Router and manages
 * the Bree job scheduler for background tasks.
 */

import tanstackHandler, {
	type ServerEntry,
} from "@tanstack/react-start/server-entry";
import { config } from "dotenv";
import { closeDatabase } from "@/db";
import { registerAllCronJobs } from "@/jobs/cron/jobs";
import { startScheduler, stopScheduler } from "@/jobs/scheduler";
import { validateRoutingConfiguration } from "@/lib/llm-routing";
import { startWorker } from "@/lib/taskqueue/run-worker";
import type { TaskQueueWorker } from "@/lib/taskqueue/worker";
import { createLogger } from "@/utils/logger";
import { getReleaseMetadata } from "@/utils/release";
import {
	ensureRequestContext,
	extractRequestId,
} from "@/utils/request-context";

// Load environment variables from .env files
// Priority: .env.development -> .env (later files override)
const nodeEnv = process.env.NODE_ENV || "development";
config({ path: `.env.${nodeEnv}` }); // Load .env.development first
config(); // Then load .env (defaults)

// OpenTelemetry is initialized via --import ./scripts/instrumentation.mjs
// before this module loads, ensuring HttpInstrumentation patches http early.

const logger = createLogger("app");
const release = getReleaseMetadata();

const globalState = globalThis as unknown as {
	__kosaricaBackgroundStarted?: boolean;
	__kosaricaTaskWorker?: TaskQueueWorker;
};

/**
 * Initialize the server and start background services.
 */
async function initServer(): Promise<void> {
	logger.info("Initializing server...");

	if (globalState.__kosaricaBackgroundStarted) {
		return;
	}
	globalState.__kosaricaBackgroundStarted = true;

	// Register cron handlers in ALL workers so manual API triggers work
	// regardless of which worker receives the request.
	registerAllCronJobs();

	// In cluster mode, only worker 0 runs background services.
	// Other workers are HTTP-only (set by start-server.mjs).
	if (process.env.SKIP_BACKGROUND_SERVICES === "1") {
		logger.info("Background services skipped (HTTP-only worker)");
		return;
	}

	// Validate DB-managed LLM endpoint routing before background jobs start.
	await validateRoutingConfiguration();

	// Start the job scheduler (tick loop only — handlers already registered above)
	try {
		startScheduler();
		logger.info("Job scheduler started");
	} catch (error) {
		logger.error("Failed to start job scheduler", { error });
	}

	// Start the task queue worker (distributed via DB locking)
	try {
		globalState.__kosaricaTaskWorker = await startWorker({ background: true });
		logger.info("Task queue worker started");
	} catch (error) {
		logger.error("Failed to start task queue worker", { error });
	}
}

/**
 * Graceful shutdown handler.
 * Stops the scheduler, closes database connections, and shuts down OpenTelemetry.
 */
async function shutdown(signal: string, exitCode = 0): Promise<void> {
	logger.info(`Received ${signal}, shutting down gracefully...`);

	try {
		stopScheduler();
		logger.info("Job scheduler stopped");
	} catch (error) {
		logger.error("Error stopping scheduler", { error });
	}

	try {
		await globalState.__kosaricaTaskWorker?.stop();
	} catch (error) {
		logger.error("Error stopping task queue worker", { error });
	}

	try {
		closeDatabase();
		logger.info("Database connection closed");
	} catch (error) {
		logger.error("Error closing database", { error });
	}

	// OTel SDK shutdown is handled by scripts/instrumentation.mjs SIGTERM handler

	process.exit(exitCode);
}

// Register shutdown handlers
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("unhandledRejection", (reason) => {
	logger.error(
		"Unhandled promise rejection",
		{ release: release.release },
		reason,
	);
});
process.on("uncaughtException", (error) => {
	logger.error("Uncaught exception", { release: release.release }, error);
	void shutdown("uncaughtException", 1);
});

// Initialize on module load
initServer().catch((error) => {
	logger.error("Server initialization failed", { error });
	process.exit(1);
});

/**
 * Wrap the fetch handler with request context
 */
type StartRequestOptions = Parameters<typeof tanstackHandler.fetch>[1];

const wrappedFetch: ServerEntry["fetch"] = async (request, maybeOpts) => {
	let handlerOpts: StartRequestOptions | undefined;

	if (maybeOpts && typeof maybeOpts === "object" && "context" in maybeOpts) {
		handlerOpts = maybeOpts as StartRequestOptions;
	}

	const requestId = extractRequestId(request);
	return ensureRequestContext(requestId, () =>
		tanstackHandler.fetch(request, handlerOpts),
	);
};

/**
 * Export the server handler
 */
export default {
	fetch: wrappedFetch,
} satisfies ServerEntry;
