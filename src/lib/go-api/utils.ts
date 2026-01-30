/**
 * Utility functions for working with the generated SDK responses.
 */

/**
 * Result type from SDK calls when throwOnError is false (default).
 * The SDK returns either { data, error: undefined } or { data: undefined, error }
 */
interface SdkResult<TData, TError = unknown> {
	data: TData | undefined;
	error: TError | undefined;
	request: Request;
	response: Response;
}

/**
 * Unwraps an SDK response, throwing if there was an error.
 * Returns the data on success.
 *
 * @param result - The SDK response result
 * @returns The data from the response
 * @throws Error if the response contains an error
 */
export function unwrapSdkResponse<TData>(
	result: SdkResult<TData, unknown>,
): TData {
	if (result.error !== undefined) {
		const errorMessage =
			typeof result.error === "string"
				? result.error
				: typeof result.error === "object" && result.error !== null
					? (result.error as { message?: string }).message ||
						JSON.stringify(result.error)
					: "Request failed";
		throw new Error(errorMessage);
	}
	return result.data as TData;
}
