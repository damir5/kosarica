export interface GoServiceResponse {
	success: boolean;
	data?: unknown;
	error?: string;
}

interface FetchWithRetryOptions extends Omit<RequestInit, "timeout"> {
	timeout?: number;
	maxRetries?: number;
	retryDelay?: number;
}

// Use GO_SERVICE_URL as the canonical address for the Go price-service in
// development and tests. Do not infer the Go service location from the
// frontend PORT value.
const INTERNAL_API_KEY =
	process.env.INTERNAL_API_KEY || "dev-internal-api-key-change-in-development";

async function goFetch(
	path: string,
	options?: RequestInit,
): Promise<GoServiceResponse> {
	const base = process.env.GO_SERVICE_URL || "http://localhost:3003";
	const url = `${base}${path}`;

	const response = await fetch(url, {
		...options,
		headers: {
			"Content-Type": "application/json",
			"X-Internal-API-Key": INTERNAL_API_KEY,
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		return {
			success: false,
			error: errorText || "Request failed",
		};
	}

	const data = await response.json();
	return {
		success: true,
		data,
	};
}

async function goFetchWithRetry(
	path: string,
	options?: FetchWithRetryOptions,
): Promise<GoServiceResponse> {
	const {
		maxRetries = 3,
		retryDelay = 1000,
		timeout = 5000,
		...fetchOptions
	} = options || {};

	let lastError: string | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		try {
			const controller = new AbortController();
			timeoutId = setTimeout(() => controller.abort(), timeout);

			const response = await goFetch(path, {
				...fetchOptions,
				signal: controller.signal,
			});

			if (timeoutId) clearTimeout(timeoutId);

			if (response.success || attempt === maxRetries) {
				return response;
			}

			lastError = response.error;
		} catch (error) {
			if (timeoutId) clearTimeout(timeoutId);
			lastError = error instanceof Error ? error.message : String(error);

			if (attempt < maxRetries) {
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
			}
		}
	}

	return {
		success: false,
		error: lastError || `Failed after ${maxRetries + 1} attempts`,
	};
}

/**
 * Helper to extract data from GoServiceResponse or throw error
 */
function unwrapResponse(response: GoServiceResponse): unknown {
	console.log("unwrapResponse called with:", JSON.stringify(response, null, 2));
	if (!response.success) {
		throw new Error(response.error || "Request failed");
	}
	console.log("unwrapResponse returning data:", JSON.stringify(response.data, null, 2));
	return response.data;
}

export { goFetch, goFetchWithRetry, unwrapResponse };

export async function scheduleIngestion(
	chainId: string,
	targetDate?: string,
): Promise<{ id: string }> {
	const options = targetDate ? { targetDate } : {};
	const response = await goFetch(`/internal/admin/ingest/${chainId}`, {
		method: "POST",
		body: JSON.stringify(options),
	});

	if (!response.success) {
		throw new Error(response.error || "Failed to schedule ingestion");
	}

	return response.data as { id: string };
}

export async function rerunIngestion(runId: string): Promise<void> {
	const response = await goFetch(`/internal/ingestion/reruns/${runId}`, {
		method: "POST",
	});

	if (!response.success) {
		throw new Error(response.error || "Failed to rerun ingestion");
	}
}

export async function getIngestionRuns(limit?: number): Promise<unknown[]> {
	const url = `/internal/ingestion/runs${limit ? `?limit=${limit}` : ""}`;
	const response = await goFetch(url, {
		method: "GET",
	});

	if (!response.success) {
		throw new Error(response.error || "Failed to get ingestion runs");
	}

	return response.data as unknown[];
}
