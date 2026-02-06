import type { Result } from "neverthrow";
import { err, ok, ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "./errors";

export interface SafeFetchOptions {
	maxRetries?: number;
	initialBackoffMs?: number;
	maxBackoffMs?: number;
	requestsPerSecond?: number;
	headers?: Record<string, string>;
	method?: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

function calculateBackoff(
	attempt: number,
	initialMs: number,
	maxMs: number,
): number {
	const exponential = initialMs * 2 ** attempt;
	const capped = Math.min(exponential, maxMs);
	return capped + Math.random() * 0.25 * capped;
}

function calculateRateLimitBackoff(
	attempt: number,
	initialMs: number,
	maxMs: number,
	retryAfter?: string,
): number {
	if (retryAfter) {
		const seconds = Number.parseInt(retryAfter, 10);
		if (!Number.isNaN(seconds) && seconds > 0) {
			return seconds * 1000 + Math.random() * 1000;
		}
	}

	const exponential = initialMs * 3 ** attempt;
	const capped = Math.min(exponential, maxMs);
	return capped + Math.random() * 0.25 * capped;
}

export function safeFetch(
	url: string,
	options?: SafeFetchOptions,
): ResultAsync<Response, FetchError> {
	const maxRetries = options?.maxRetries ?? 3;
	const initialBackoffMs = options?.initialBackoffMs ?? 100;
	const maxBackoffMs = options?.maxBackoffMs ?? 30_000;
	const requestsPerSecond = options?.requestsPerSecond ?? 2;
	const minInterval = 1000 / requestsPerSecond;
	let lastRequestTime = 0;

	async function attempt(
		attemptNum: number,
	): Promise<Result<Response, FetchError>> {
		const now = Date.now();
		const elapsed = now - lastRequestTime;
		if (elapsed < minInterval) {
			await sleep(minInterval - elapsed);
		}
		lastRequestTime = Date.now();

		try {
			const response = await fetch(url, {
				method: options?.method ?? "GET",
				headers: {
					"User-Agent": "Kosarica-Ingestion/1.0",
					Accept: "*/*",
					...(options?.headers ?? {}),
				},
			});

			if (response.ok) {
				return ok(response);
			}

			if (!isRetryableStatus(response.status) || attemptNum === maxRetries) {
				return err(
					fetchError({
						url,
						status: response.status,
						message: `HTTP ${response.status}: ${response.statusText}`,
						retryable: isRetryableStatus(response.status),
						attempts: attemptNum + 1,
					}),
				);
			}

			const retryAfter = response.headers.get("Retry-After") ?? undefined;
			const delay =
				response.status === 429
					? calculateRateLimitBackoff(
							attemptNum,
							initialBackoffMs,
							maxBackoffMs,
							retryAfter,
						)
					: calculateBackoff(attemptNum, initialBackoffMs, maxBackoffMs);
			await sleep(delay);
			return attempt(attemptNum + 1);
		} catch (error) {
			if (attemptNum === maxRetries) {
				return err(
					fetchError({
						url,
						message: error instanceof Error ? error.message : String(error),
						retryable: true,
						attempts: attemptNum + 1,
						cause: error,
					}),
				);
			}
			const delay = calculateBackoff(
				attemptNum,
				initialBackoffMs,
				maxBackoffMs,
			);
			await sleep(delay);
			return attempt(attemptNum + 1);
		}
	}

	return new ResultAsync(attempt(0));
}
