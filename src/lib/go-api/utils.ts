/**
 * Go API SDK Utilities
 *
 * Helper functions for working with the generated Go API SDK.
 */

/**
 * Unwraps an SDK response to extract data or throw an error.
 *
 * The generated SDK returns responses in the format:
 * - Success: `{ data: T, request: Request, response: Response }`
 * - Error: `{ error: unknown, request: Request, response: Response | undefined }`
 *
 * This helper extracts the data on success or throws the error on failure.
 *
 * @param result - The SDK response object
 * @returns The data from the response
 * @throws The error from the response if present
 */
export function unwrapSdkResponse<T>(
	result:
		| {
				data: T;
				request: Request;
				response: Response;
		  }
		| {
				error: unknown;
				request: Request;
				response: Response | undefined;
		  },
): T {
	if ("error" in result && result.error !== undefined) {
		throw result.error;
	}

	if (!("data" in result)) {
		throw new Error("Invalid SDK response: neither data nor error present");
	}

	return result.data;
}

/**
 * Type guard to check if an SDK response is successful.
 */
export function isSdkResponseSuccess<T>(
	result:
		| {
				data: T;
				request: Request;
				response: Response;
		  }
		| {
				error: unknown;
				request: Request;
				response: Response | undefined;
		  },
): result is { data: T; request: Request; response: Response } {
	return "data" in result && result.data !== undefined;
}

/**
 * Type guard to check if an SDK response is an error.
 */
export function isSdkResponseError(
	result:
		| {
				data: unknown;
				request: Request;
				response: Response;
		  }
		| {
				error: unknown;
				request: Request;
				response: Response | undefined;
		  },
): result is {
	error: unknown;
	request: Request;
	response: Response | undefined;
} {
	return "error" in result && result.error !== undefined;
}
