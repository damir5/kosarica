/**
 * Go API Client Configuration
 *
 * Configures the generated SDK client with proper base URL and authentication.
 * This file provides a configured client instance for use across the application.
 */

import { client } from "./client.gen";

const INTERNAL_API_KEY =
	process.env.INTERNAL_API_KEY || "dev-internal-api-key-change-in-development";

const GO_SERVICE_URL = process.env.GO_SERVICE_URL || "http://localhost:3003";

// Configure the client with base URL and auth headers
client.setConfig({
	baseUrl: GO_SERVICE_URL,
	headers: {
		"X-Internal-API-Key": INTERNAL_API_KEY,
	},
});

export { client };

/**
 * Helper to unwrap SDK response or throw error
 * Compatible with the generated SDK response format { data?, error?, response }
 */
export function unwrapSdkResponse<T>(result: {
	data?: T;
	error?: unknown;
	response?: Response;
}): T {
	if (result.error !== undefined) {
		const errorMessage =
			typeof result.error === "string"
				? result.error
				: typeof result.error === "object" && result.error !== null
					? JSON.stringify(result.error)
					: "Request failed";
		throw new Error(errorMessage);
	}
	return result.data as T;
}
