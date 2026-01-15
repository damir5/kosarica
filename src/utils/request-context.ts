import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
	requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

function generateRequestId(): string {
	return `req_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Run a function with request context.
 * This establishes the request ID for the entire async execution chain.
 */
export function runWithContext<T>(
	requestId: string,
	fn: () => T | Promise<T>,
): T | Promise<T> {
	return asyncLocalStorage.run({ requestId }, fn);
}

/**
 * Ensure a request context exists before running the provided function.
 * If a context is already active, it simply runs the function.
 */
export function ensureRequestContext<T>(
	requestId: string,
	fn: () => T | Promise<T>,
): T | Promise<T> {
	const store = asyncLocalStorage.getStore();

	if (store?.requestId) {
		return fn();
	}

	return runWithContext(requestId ?? generateRequestId(), fn);
}

/**
 * Get the current request ID from async context if available.
 * Falls back to generating a new correlation ID when no context exists.
 */
export function getRequestId(): string | undefined {
	return asyncLocalStorage.getStore()?.requestId;
}

/**
 * Extract request ID from HTTP request headers.
 * Tries CF-Ray first (Cloudflare's request ID), then X-Request-ID, then generates a new prefixed ID.
 */
export function extractRequestId(request: Request): string {
	// Try CF-Ray (Cloudflare's request ID)
	const cfRay = request.headers.get("cf-ray");
	if (cfRay) {
		const rayId = cfRay.split("-")[0]; // Just the hex part before the dash
		return `req_${rayId}`;
	}

	// Try X-Request-ID (standard header)
	const xRequestId = request.headers.get("x-request-id");
	if (xRequestId) {
		return `req_${xRequestId}`;
	}

	// Generate a new prefixed ID
	return generateRequestId();
}
