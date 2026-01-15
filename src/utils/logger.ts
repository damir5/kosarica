/**
 * Structured JSONL logger compatible with Cloudflare Workers
 * Uses pino-compatible log format for use with pino-pretty in development
 */

import { serializeError } from "serialize-error";
import { getRequestId } from "./request-context";

/**
 * Convert an error to a plain object with stack trace preserved.
 * Use this to serialize errors for logging or API responses.
 */
export function errorToObject(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		return serializeError(error);
	}
	return { message: String(error) };
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * All available logger types for filtering
 * Source of truth for LoggerType - add new types here
 */
const ALL_LOGGER_TYPES = ["rpc", "http", "auth", "db", "app", "ingestion"] as const;
export type LoggerType = (typeof ALL_LOGGER_TYPES)[number];

/**
 * Log level ordering for comparison (higher = more severe)
 */
const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

/**
 * Pino-compatible numeric log levels
 */
const PINO_LEVELS: Record<LogLevel, number> = {
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
};

/**
 * Check if running in development mode
 */
const isDev = process.env.NODE_ENV === "development";

/**
 * Extract caller location from stack trace (dev only)
 * Returns format: "src/utils/logger.ts:42:5"
 */
function getCallerLocation(): string | undefined {
	if (!isDev) return undefined;

	const err = new Error();
	const stack = err.stack;
	if (!stack) return undefined;

	// Stack format: Error\n    at fn (file:line:col)\n...
	// We need to skip: Error, getCallerLocation, formatLogEntry, debug/info/warn/error
	const lines = stack.split("\n");

	// Find the first line that's not from logger.ts
	for (const line of lines) {
		if (line.includes("logger.ts")) continue;
		if (line.includes("Error")) continue;

		// Match file:line:col pattern
		const match =
			line.match(/\((.+):(\d+):(\d+)\)$/) || line.match(/at (.+):(\d+):(\d+)$/);
		if (match) {
			let filePath = match[1];
			// Clean up the path - remove everything before src/
			const srcIndex = filePath.indexOf("src/");
			if (srcIndex !== -1) {
				filePath = filePath.slice(srcIndex);
			}
			return `${filePath}:${match[2]}:${match[3]}`;
		}
	}

	return undefined;
}

/**
 * Log configuration parsed from environment
 */
interface LogConfig {
	level: LogLevel;
	enabledTypes: Set<LoggerType> | "all";
}

/**
 * Cached log configuration (parsed once per isolate)
 */
let cachedLogConfig: LogConfig | null = null;

/**
 * Parse LOG_TYPES environment variable
 * Supports: "*" (all), "type1,type2" (include), "*,-type1,-type2" (exclude)
 */
function parseLogTypes(typesStr: string | undefined): Set<LoggerType> | "all" {
	if (!typesStr || typesStr === "*") return "all";
	if (typesStr === "none") return new Set();

	const tokens = typesStr.split(",").map((t) => t.trim());

	// Check for exclusion mode (starts with "*")
	if (tokens[0] === "*") {
		const all = new Set<LoggerType>(ALL_LOGGER_TYPES);
		for (const token of tokens.slice(1)) {
			if (token.startsWith("-")) {
				const type = token.slice(1) as LoggerType;
				if (ALL_LOGGER_TYPES.includes(type)) {
					all.delete(type);
				}
			}
		}
		return all;
	}

	// Include mode
	const enabled = new Set<LoggerType>();
	for (const token of tokens) {
		if (
			!token.startsWith("-") &&
			ALL_LOGGER_TYPES.includes(token as LoggerType)
		) {
			enabled.add(token as LoggerType);
		}
	}
	return enabled;
}

/**
 * Get log configuration from environment
 */
function getLogConfig(): LogConfig {
	if (cachedLogConfig) return cachedLogConfig;

	const level = (process.env.LOG_LEVEL as LogLevel) ?? "info";
	const typesStr = process.env.LOG_TYPES;

	cachedLogConfig = {
		level,
		enabledTypes: parseLogTypes(typesStr),
	};

	return cachedLogConfig;
}

/**
 * Check if a log should be emitted based on level and logger type
 */
function shouldLog(level: LogLevel, loggerType?: LoggerType): boolean {
	const config = getLogConfig();

	// Check log level
	if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[config.level]) {
		return false;
	}

	// Check logger type (if filtering is enabled and type is specified)
	if (config.enabledTypes !== "all" && loggerType) {
		return config.enabledTypes.has(loggerType);
	}

	return true;
}

/**
 * Reset cached log config (useful for testing)
 */
export function resetLogConfig(): void {
	cachedLogConfig = null;
}

export interface LogContext {
	operation?: string;
	duration?: number;
	[key: string]: unknown;
}

/**
 * Pino-compatible log entry structure
 */
interface PinoLogEntry {
	level: number;
	time: number;
	msg: string;
	caller?: string;
	loggerType?: LoggerType;
	requestId?: string;
	[key: string]: unknown;
}

/**
 * Sanitize sensitive data from objects before logging.
 * Converts Error instances to plain objects with stack traces preserved.
 * Converts BigInt values to strings for JSON serialization.
 */
export function sanitize(data: unknown, depth = 0): unknown {
	// Handle BigInt at the top level
	if (typeof data === "bigint") {
		return `${data.toString()}n`;
	}

	if (!data || typeof data !== "object") {
		return data;
	}

	// Prevent infinite recursion
	if (depth > 5) return "[Max Depth Reached]";

	// Serialize Error instances to preserve stack traces
	if (data instanceof Error) {
		const serialized = serializeError(data);
		return sanitize(serialized, depth + 1);
	}

	if (Array.isArray(data)) {
		return data.map((item) => sanitize(item, depth + 1));
	}

	const sanitized: Record<string, unknown> = {};
	const sensitiveKeys = [
		"password",
		"apikey",
		"api_key",
		"secret",
		"token",
		"authorization",
		"signingkey",
	];

	for (const [key, value] of Object.entries(data)) {
		const lowerKey = key.toLowerCase();
		if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
			sanitized[key] = "[REDACTED]";
		} else if (typeof value === "bigint") {
			sanitized[key] = `${value.toString()}n`;
		} else if (value && typeof value === "object") {
			sanitized[key] = sanitize(value, depth + 1);
		} else {
			sanitized[key] = value;
		}
	}

	return sanitized;
}

/**
 * Merge error into context, serializing Error instances
 */
function mergeErrorIntoContext(
	context: LogContext | undefined,
	error: unknown,
): LogContext {
	const base = context ?? {};
	if (error !== undefined) {
		return {
			...base,
			error: error instanceof Error ? serializeError(error) : error,
		};
	}
	return base;
}

/**
 * Format log entry as pino-compatible JSON
 * Fields are at top level (not nested) for pino-pretty compatibility
 */
function formatLogEntry(
	level: LogLevel,
	message: string,
	context?: LogContext,
	loggerType?: LoggerType,
	requestId?: string,
): string {
	const entry: PinoLogEntry = {
		level: PINO_LEVELS[level],
		time: Date.now(),
		msg: message,
	};

	// Add caller location in dev mode
	const caller = getCallerLocation();
	if (caller) {
		entry.caller = caller;
	}

	if (loggerType) {
		entry.loggerType = loggerType;
	}

	if (requestId) {
		entry.requestId = requestId;
	}

	// Spread context fields at top level for pino-pretty compatibility
	if (context && Object.keys(context).length > 0) {
		const sanitized = sanitize(context) as LogContext;
		Object.assign(entry, sanitized);
	}

	return JSON.stringify(entry);
}

/**
 * Logger class with structured logging support
 */
class Logger {
	private loggerType?: LoggerType;

	constructor(loggerType?: LoggerType) {
		this.loggerType = loggerType;
	}

	debug(message: string, context?: LogContext, error?: unknown): void {
		if (!shouldLog("debug", this.loggerType)) return;

		const mergedContext =
			error !== undefined ? mergeErrorIntoContext(context, error) : context;
		const sanitizedContext = mergedContext
			? (sanitize(mergedContext) as LogContext)
			: undefined;
		const requestId = getRequestId();

		console.debug(
			formatLogEntry(
				"debug",
				message,
				sanitizedContext,
				this.loggerType,
				requestId,
			),
		);
	}

	info(message: string, context?: LogContext, error?: unknown): void {
		if (!shouldLog("info", this.loggerType)) return;

		const mergedContext =
			error !== undefined ? mergeErrorIntoContext(context, error) : context;
		const sanitizedContext = mergedContext
			? (sanitize(mergedContext) as LogContext)
			: undefined;
		const requestId = getRequestId();

		console.log(
			formatLogEntry(
				"info",
				message,
				sanitizedContext,
				this.loggerType,
				requestId,
			),
		);
	}

	warn(message: string, context?: LogContext, error?: unknown): void {
		if (!shouldLog("warn", this.loggerType)) return;

		const mergedContext =
			error !== undefined ? mergeErrorIntoContext(context, error) : context;
		const sanitizedContext = mergedContext
			? (sanitize(mergedContext) as LogContext)
			: undefined;
		const requestId = getRequestId();

		console.warn(
			formatLogEntry(
				"warn",
				message,
				sanitizedContext,
				this.loggerType,
				requestId,
			),
		);
	}

	error(message: string, context?: LogContext, error?: unknown): void {
		if (!shouldLog("error", this.loggerType)) return;

		const mergedContext =
			error !== undefined ? mergeErrorIntoContext(context, error) : context;
		const sanitizedContext = mergedContext
			? (sanitize(mergedContext) as LogContext)
			: undefined;
		const requestId = getRequestId();

		console.error(
			formatLogEntry(
				"error",
				message,
				sanitizedContext,
				this.loggerType,
				requestId,
			),
		);
	}

	/**
	 * Create a child logger with a base operation context
	 */
	child(baseContext: LogContext): Logger {
		const childLogger = new Logger(this.loggerType);
		const originalMethods = {
			debug: childLogger.debug.bind(childLogger),
			info: childLogger.info.bind(childLogger),
			warn: childLogger.warn.bind(childLogger),
			error: childLogger.error.bind(childLogger),
		};

		childLogger.debug = (
			message: string,
			context?: LogContext,
			error?: unknown,
		) => {
			originalMethods.debug(message, { ...baseContext, ...context }, error);
		};

		childLogger.info = (
			message: string,
			context?: LogContext,
			error?: unknown,
		) => {
			originalMethods.info(message, { ...baseContext, ...context }, error);
		};

		childLogger.warn = (
			message: string,
			context?: LogContext,
			error?: unknown,
		) => {
			originalMethods.warn(message, { ...baseContext, ...context }, error);
		};

		childLogger.error = (
			message: string,
			context?: LogContext,
			error?: unknown,
		) => {
			originalMethods.error(message, { ...baseContext, ...context }, error);
		};

		return childLogger;
	}
}

// Export singleton instance (default app logger)
export const logger = new Logger("app");

/**
 * Create a logger with a specific type
 */
export function createLogger(loggerType: LoggerType): Logger {
	return new Logger(loggerType);
}

/**
 * Helper to measure execution time
 */
export function measureTime<T>(
	fn: () => T | Promise<T>,
): Promise<{ result: T; duration: number }> {
	const start = Date.now();
	const resultOrPromise = fn();

	if (resultOrPromise instanceof Promise) {
		return resultOrPromise.then((result) => ({
			result,
			duration: Date.now() - start,
		}));
	}

	return Promise.resolve({
		result: resultOrPromise,
		duration: Date.now() - start,
	});
}
