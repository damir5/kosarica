interface GoServiceResponse {
	success: boolean;
	data?: unknown;
	error?: string;
}

interface IngestOptions {
	targetDate?: string;
}

const GO_SERVICE_BASE_URL =
	process.env.GO_SERVICE_BASE_URL || "http://localhost:8081";
const INTERNAL_API_KEY =
	process.env.INTERNAL_API_KEY || "dev-internal-api-key-change-in-production";

async function goFetch(
	path: string,
	options?: RequestInit,
): Promise<GoServiceResponse> {
	const url = `${GO_SERVICE_BASE_URL}${path}`;

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
	return data;
}

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
