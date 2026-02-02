export function unwrapSdkResponse<T>(result: unknown): T {
	if (result === undefined) {
		throw new Error("Request failed");
	}

	if (result && typeof result === "object") {
		if ("error" in result) {
			const errorValue = (result as { error?: unknown }).error;
			if (errorValue !== undefined && errorValue !== null) {
				throw new Error(formatSdkError(errorValue));
			}
		}

		if ("data" in result) {
			return (result as { data?: T }).data as T;
		}
	}

	return result as T;
}

function formatSdkError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === "string") {
		return error;
	}

	if (error && typeof error === "object") {
		if (
			"message" in error &&
			typeof (error as { message?: unknown }).message === "string"
		) {
			return (error as { message: string }).message;
		}

		try {
			return JSON.stringify(error);
		} catch {
			return "Request failed";
		}
	}

	return "Request failed";
}
