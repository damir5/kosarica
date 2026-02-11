/**
 * Structured JSONL logger for Node.js using pino
 * Maintains pino-compatible log format for use with pino-pretty in development
 */

import pino from "pino";
import { serializeError } from "serialize-error";
import { getReleaseMetadata } from "./release";
import { getRequestId } from "./request-context";

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * All available logger types for filtering
 * Source of truth for LoggerType - add new types here
 */
const ALL_LOGGER_TYPES = [
	"rpc",
	"http",
	"auth",
	"db",
	"app",
	"ingestion",
	"scheduler",
	"daily-ingestion",
	"temp-cleanup",
	"matching",
	"search",
	"rum",
] as const;
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
	// We need to skip: Error, getCallerLocation, and pino internals
	const lines = stack.split("\n");

	// Find the first line that's not from logger.ts or pino internals
	for (const line of lines) {
		if (line.includes("logger.ts")) continue;
		if (line.includes("node_modules/pino")) continue;
		if (line.includes("Error")) continue;
		if (line.trim() === "") continue;

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
 * Convert an error to a plain object with stack trace preserved.
 * Use this to serialize errors for logging or API responses.
 */
export function errorToObject(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		return serializeError(error);
	}
	return { message: String(error) };
}

/**
 * Sensitive field keys for redaction
 */
const SENSITIVE_KEYS = [
	"password",
	"apikey",
	"api_key",
	"secret",
	"token",
	"authorization",
	"signingkey",
];

/**
 * Pino redaction paths for sensitive data
 */
const PINO_REDACT_PATHS = SENSITIVE_KEYS.map((key) => `[${key}]`);

/**
 * Create pino redaction paths for nested objects
 */
const NESTED_REDACT_PATHS = SENSITIVE_KEYS.flatMap((key) => [
	`[*].${key}`,
	`*.${key}`,
]);

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

	for (const [key, value] of Object.entries(data)) {
		const lowerKey = key.toLowerCase();
		if (SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))) {
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
 * Create a custom pino destination that filters based on shouldLog
 */
function createFilteredDestination(_loggerType?: LoggerType) {
	// Use pino's default destination (stdout/stderr)
	return pino.destination({
		sync: false,
	});
}

/**
 * Create pino configuration for a specific logger type
 */
function createPinoConfig(loggerType?: LoggerType): pino.LoggerOptions {
	const release = getReleaseMetadata();

	return {
		level: (process.env.LOG_LEVEL as LogLevel) ?? "info",
		formatters: {
			level: (label) => ({ level: label }),
			log: (object) => {
				// Add caller location in dev mode
				if (isDev) {
					const caller = getCallerLocation();
					if (caller) {
						object.caller = caller;
					}
				}
				// Add loggerType if specified
				if (loggerType) {
					object.loggerType = loggerType;
				}
				return object;
			},
		},
		serializers: {
			err: (err) => serializeError(err),
		},
		redact: {
			paths: [...PINO_REDACT_PATHS, ...NESTED_REDACT_PATHS],
			censor: "[REDACTED]",
			remove: true,
		},
		base: {
			service: "kosarica-nodejs",
			release: release.release,
			serviceVersion: release.version,
			environment: release.environment,
		},
		timestamp: () => `,"time":${Date.now()}`,
		mixin: () => {
			const mixinData: Record<string, unknown> = {};
			const requestId = getRequestId();
			if (requestId) mixinData.requestId = requestId;
			return mixinData;
		},
	};
}

/**
 * Pino instance cache for each logger type
 */
const pinoCache = new Map<LoggerType | undefined, pino.Logger>();

/**
 * Get or create a pino instance for a specific logger type
 */
function getPinoLogger(loggerType?: LoggerType): pino.Logger {
	const existing = pinoCache.get(loggerType);
	if (existing) {
		return existing;
	}

	const pinoInstance = pino(
		createPinoConfig(loggerType),
		createFilteredDestination(loggerType),
	);

	pinoCache.set(loggerType, pinoInstance);
	return pinoInstance;
}

/**
 * Logger class with structured logging support using pino
 */
class Logger {
	private pinoLogger: pino.Logger;
	private loggerType?: LoggerType;
	private baseContext?: LogContext;

	constructor(loggerType?: LoggerType, baseContext?: LogContext) {
		this.loggerType = loggerType;
		this.baseContext = baseContext;
		this.pinoLogger = getPinoLogger(loggerType);
	}

	private shouldLog(level: LogLevel): boolean {
		return shouldLog(level, this.loggerType);
	}

	private prepareContext(
		context?: LogContext,
		error?: unknown,
	): Record<string, unknown> {
		let result: Record<string, unknown> = {};

		// Add base context from child logger
		if (this.baseContext) {
			result = { ...result, ...this.baseContext };
		}

		// Add provided context
		if (context && Object.keys(context).length > 0) {
			result = { ...result, ...context };
		}

		// Add error if provided
		if (error !== undefined) {
			if (error instanceof Error) {
				result.err = error;
			} else {
				result.error = error;
			}
		}

		return result;
	}

	debug(message: string, context?: LogContext, error?: unknown): void {
		if (!this.shouldLog("debug")) return;

		const preparedContext = this.prepareContext(context, error);
		this.pinoLogger.debug(preparedContext, message);
	}

	info(message: string, context?: LogContext, error?: unknown): void {
		if (!this.shouldLog("info")) return;

		const preparedContext = this.prepareContext(context, error);
		this.pinoLogger.info(preparedContext, message);
	}

	warn(message: string, context?: LogContext, error?: unknown): void {
		if (!this.shouldLog("warn")) return;

		const preparedContext = this.prepareContext(context, error);
		this.pinoLogger.warn(preparedContext, message);
	}

	error(message: string, context?: LogContext, error?: unknown): void {
		if (!this.shouldLog("error")) return;

		const preparedContext = this.prepareContext(context, error);
		this.pinoLogger.error(preparedContext, message);
	}

	/**
	 * Create a child logger with a base operation context
	 */
	child(baseContext: LogContext): Logger {
		return new Logger(this.loggerType, {
			...this.baseContext,
			...baseContext,
		});
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
export async function measureTime<T>(
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
