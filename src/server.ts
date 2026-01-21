/**
 * Server entry point for TanStack Start with Node.js
 *
 * Handles HTTP requests via TanStack Router and manages
 * the Bree job scheduler for background tasks.
 */

import { config } from "dotenv";
import tanstackHandler, {
	type ServerEntry,
} from "@tanstack/react-start/server-entry";
import { createLogger } from "@/utils/logger";
import {
	ensureRequestContext,
	extractRequestId,
} from "@/utils/request-context";
import { startScheduler, stopScheduler } from "@/jobs/scheduler";
import { closeDatabase } from "@/db";
import { initTelemetry, shutdownTelemetry } from "@/telemetry";

// Load environment variables from .env files
// Priority: .env.development -> .env (later files override)
const nodeEnv = process.env.NODE_ENV || "development";
config({ path: `.env.${nodeEnv}` }); // Load .env.development first
config(); // Then load .env (defaults)

// Initialize OpenTelemetry first, before any other imports
const telemetrySdk = initTelemetry();

const logger = createLogger("app");

/**
 * Initialize the server and start background services.
 */
async function initServer(): Promise<void> {
	logger.info("Initializing server...");

	// Start the job scheduler
	try {
		await startScheduler();
		logger.info("Job scheduler started");
	} catch (error) {
		logger.error("Failed to start job scheduler", { error });
	}
}

/**
 * Graceful shutdown handler.
 * Stops the scheduler, closes database connections, and shuts down OpenTelemetry.
 */
async function shutdown(signal: string): Promise<void> {
	logger.info(`Received ${signal}, shutting down gracefully...`);

	try {
		await stopScheduler();
		logger.info("Job scheduler stopped");
	} catch (error) {
		logger.error("Error stopping scheduler", { error });
	}

	try {
		closeDatabase();
		logger.info("Database connection closed");
	} catch (error) {
		logger.error("Error closing database", { error });
	}

	try {
		await shutdownTelemetry(telemetrySdk);
	} catch (error) {
		logger.error("Error shutting down telemetry", { error });
	}

	process.exit(0);
}

// Register shutdown handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

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
