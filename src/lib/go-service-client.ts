/**
 * Go Service Client
 *
 * Resilient HTTP client for communicating with the Go price-service.
 * Features:
 * - Circuit breaker for fault tolerance
 * - Timeout handling
 * - Retry logic for idempotent operations
 * - Request tracing with X-Request-ID
 */

interface GoServiceConfig {
	url: string;
	apiKey: string;
	defaultTimeout?: number;
}

interface GoServiceError extends Error {
	status: number;
	body: string;
}

class GoServiceErrorImpl extends Error implements GoServiceError {
	status: number;
	body: string;

	constructor(status: number, body: string) {
		super(`Go service error: ${status} - ${body}`);
		this.name = "GoServiceError";
		this.status = status;
		this.body = body;
	}
}

// Circuit breaker state
interface CircuitBreakerState {
	failures: number;
	lastFailureTime: number;
	state: "closed" | "open" | "half-open";
}

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

const circuitBreaker: CircuitBreakerState = {
	failures: 0,
	lastFailureTime: 0,
	state: "closed",
};

// Get configuration from environment
function getConfig(): GoServiceConfig {
	const url = process.env.GO_SERVICE_URL || "http://localhost:8080";
	const apiKey = process.env.INTERNAL_API_KEY;

	if (!apiKey) {
		throw new Error("INTERNAL_API_KEY environment variable is required");
	}

	return {
		url,
		apiKey,
		defaultTimeout: 30000, // 30 seconds default
	};
}

/**
 * Check if circuit breaker should allow requests
 */
function canRequest(): boolean {
	const now = Date.now();

	if (circuitBreaker.state === "open") {
		if (now - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT) {
			// Try half-open state
			circuitBreaker.state = "half-open";
			return true;
		}
		return false;
	}

	return true;
}

/**
 * Record a successful request
 */
function recordSuccess(): void {
	circuitBreaker.failures = 0;
	circuitBreaker.state = "closed";
}

/**
 * Record a failed request
 */
function recordFailure(): void {
	circuitBreaker.failures++;
	circuitBreaker.lastFailureTime = Date.now();

	if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
		circuitBreaker.state = "open";
	}
}

/**
 * Generate a request ID for tracing
 */
function generateRequestId(): string {
	return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Internal fetch implementation with error handling
 */
async function goFetchInternal<T>(
	path: string,
	options: RequestInit & { timeout?: number },
): Promise<T> {
	if (!canRequest()) {
		throw new Error("Circuit breaker is OPEN - Go service unavailable");
	}

	const config = getConfig();
	const timeout = options.timeout ?? config.defaultTimeout ?? 30000;
	const requestId = generateRequestId();

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const url = `${config.url}${path}`;

		const response = await fetch(url, {
			...options,
			headers: {
				"Content-Type": "application/json",
				"X-Internal-API-Key": config.apiKey,
				"X-Request-ID": requestId,
				...options.headers,
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const body = await response.text();
			recordFailure();
			throw new GoServiceErrorImpl(response.status, body);
		}

		recordSuccess();
		return (await response.json()) as T;
	} catch (error) {
		clearTimeout(timeoutId);

		if (error instanceof GoServiceErrorImpl) {
			throw error;
		}

		if (error instanceof Error && error.name === "AbortError") {
			recordFailure();
			throw new Error(`Go service timeout after ${timeout}ms`);
		}

		recordFailure();
		throw error;
	}
}

/**
 * Fetch from Go service without retry
 * Use for non-idempotent operations (POST, DELETE, etc.)
 */
export async function goFetch<T>(
	path: string,
	options: Omit<RequestInit, "body"> & { body?: string | object; timeout?: number } = {},
): Promise<T> {
	const requestOptions: RequestInit = {
		...options,
		method: options.method || "GET",
	};

	if (options.body && typeof options.body === "object") {
		requestOptions.body = JSON.stringify(options.body);
	} else if (options.body && typeof options.body === "string") {
		requestOptions.body = options.body;
	}

	return goFetchInternal<T>(path, requestOptions);
}

/**
 * Fetch from Go service with retry for idempotent operations
 * Uses exponential backoff: 1s, 2s, 4s
 */
export async function goFetchWithRetry<T>(
	path: string,
	options: Omit<RequestInit, "body"> & {
		body?: string | object;
		timeout?: number;
		maxRetries?: number;
	} = {},
): Promise<T> {
	const maxRetries = options.maxRetries ?? 3;
	const baseDelay = 1000; // 1 second

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await goFetch<T>(path, options);
		} catch (error) {
			lastError = error as Error;

			// Don't retry on client errors (4xx) or GoServiceError
			if (error instanceof GoServiceErrorImpl) {
				// 4xx errors should not be retried
				if (error.status >= 400 && error.status < 500) {
					throw error;
				}
			}

			// Don't retry after the last attempt
			if (attempt === maxRetries) {
				break;
			}

			// Exponential backoff
			const delay = baseDelay * Math.pow(2, attempt);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError || new Error("goFetchWithRetry failed with unknown error");
}

export { GoServiceError };
export type { GoServiceConfig };
