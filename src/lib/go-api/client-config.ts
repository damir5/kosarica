import { client } from "./client.gen";

const GO_SERVICE_URL =
	process.env.GO_SERVICE_URL || "http://localhost:3003";
const INTERNAL_API_KEY =
	process.env.INTERNAL_API_KEY || "dev-internal-api-key-change-in-development";

// Ensure SDK requests use an absolute base URL in Node.js environments.
if (typeof window === "undefined") {
	client.setConfig({
		baseUrl: GO_SERVICE_URL,
		headers: {
			"X-Internal-API-Key": INTERNAL_API_KEY,
		},
	});
}

// Helper to extract data from OpenAPI SDK responses
export function unwrapSdkResponse<T>(
	result: { data?: T } | { data?: T },
): T | undefined {
	return result.data;
}
