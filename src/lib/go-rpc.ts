/**
 * Go RPC Helpers
 *
 * Typed query/mutation helpers for communicating with the Go price-service.
 * Provides Zod validation on all responses for type safety.
 *
 * Usage:
 *   const optimizeSingle = goQuery("/internal/basket/optimize/single", z.array(SingleStoreResultSchema));
 *   const result = await optimizeSingle({ chainSlug: "konzum", basketItems: [...] });
 */

import type { z } from "zod";
import { goFetch, goFetchWithRetry, unwrapResponse } from "./go-service-client";

interface QueryOptions {
	/** Timeout in milliseconds (default: 5000) */
	timeout?: number;
	/** Maximum retries on failure (default: 3) */
	maxRetries?: number;
	/** Delay between retries in ms (default: 1000) */
	retryDelay?: number;
}

interface MutationOptions {
	/** Timeout in milliseconds (default: 10000) */
	timeout?: number;
}

/**
 * Creates a typed query function for GET-like operations.
 * Uses retry logic for resilience.
 *
 * @param path - The API path (e.g., "/internal/basket/optimize/single")
 * @param outputSchema - Zod schema to validate the response
 * @param options - Query options (timeout, retries)
 * @returns A function that takes optional input and returns validated output
 *
 * @example
 * const getStorePrices = goQuery("/internal/prices/:chainSlug/:storeId", GetStorePricesResponseSchema);
 * const prices = await getStorePrices({ chainSlug: "konzum", storeId: "123" });
 */
export function goQuery<O>(
	path: string,
	outputSchema: z.ZodType<O>,
	options: QueryOptions = {},
) {
	const { timeout = 5000, maxRetries = 3, retryDelay = 1000 } = options;

	return async (input?: Record<string, unknown>): Promise<O> => {
		// Build URL with query params if input provided
		let url = path;
		if (input) {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(input)) {
				if (value !== undefined && value !== null) {
					params.set(key, String(value));
				}
			}
			const queryString = params.toString();
			if (queryString) {
				url = `${path}?${queryString}`;
			}
		}

		const response = await goFetchWithRetry(url, {
			timeout,
			maxRetries,
			retryDelay,
		});

		const data = unwrapResponse(response);
		return outputSchema.parse(data);
	};
}

/**
 * Creates a typed query function for POST operations that are idempotent (safe to retry).
 * Uses retry logic for resilience.
 *
 * @param path - The API path (e.g., "/internal/basket/optimize/single")
 * @param outputSchema - Zod schema to validate the response
 * @param options - Query options (timeout, retries)
 * @returns A function that takes input and returns validated output
 *
 * @example
 * const optimizeSingle = goQueryPost("/internal/basket/optimize/single", z.array(SingleStoreResultSchema));
 * const results = await optimizeSingle({ chainSlug: "konzum", basketItems: [...] });
 */
export function goQueryPost<I, O>(
	path: string,
	outputSchema: z.ZodType<O>,
	options: QueryOptions = {},
) {
	const { timeout = 5000, maxRetries = 3, retryDelay = 1000 } = options;

	return async (input: I): Promise<O> => {
		const response = await goFetchWithRetry(path, {
			method: "POST",
			body: JSON.stringify(input),
			timeout,
			maxRetries,
			retryDelay,
		});

		const data = unwrapResponse(response);
		return outputSchema.parse(data);
	};
}

/**
 * Creates a typed mutation function for non-idempotent operations.
 * Does NOT use retry logic (mutations should not be automatically retried).
 *
 * @param path - The API path (e.g., "/internal/admin/ingest/:chain")
 * @param outputSchema - Zod schema to validate the response
 * @param options - Mutation options (timeout)
 * @returns A function that takes input and returns validated output
 *
 * @example
 * const triggerIngestion = goMutation("/internal/admin/ingest", TriggerResponseSchema);
 * const result = await triggerIngestion({ chain: "konzum" });
 */
export function goMutation<I, O>(
	path: string,
	outputSchema: z.ZodType<O>,
	options: MutationOptions = {},
) {
	const { timeout = 10000 } = options;

	return async (input: I): Promise<O> => {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await goFetch(path, {
				method: "POST",
				body: JSON.stringify(input),
				signal: controller.signal,
			});

			const data = unwrapResponse(response);
			return outputSchema.parse(data);
		} finally {
			clearTimeout(timeoutId);
		}
	};
}

/**
 * Creates a typed DELETE mutation function.
 *
 * @param path - The API path (e.g., "/internal/ingestion/runs")
 * @param outputSchema - Zod schema to validate the response
 * @param options - Mutation options (timeout)
 * @returns A function that takes a single ID and returns validated output
 *
 * @example
 * const deleteRun = goDelete("/internal/ingestion/runs", DeleteResponseSchema);
 * const result = await deleteRun("abc123");
 */
export function goDelete<O>(
	path: string,
	outputSchema: z.ZodType<O>,
	options: MutationOptions = {},
) {
	const { timeout = 5000 } = options;

	return async (id: string): Promise<O> => {
		const url = `${path}/${encodeURIComponent(id)}`;

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await goFetch(url, {
				method: "DELETE",
				signal: controller.signal,
			});

			const data = unwrapResponse(response);
			return outputSchema.parse(data);
		} finally {
			clearTimeout(timeoutId);
		}
	};
}
