import { ResultAsync } from "neverthrow";
import { type DbError, dbError, isDeadlock, isUniqueViolation } from "./errors";

export function extractPgCode(error: unknown): string | undefined {
	if (error === null || typeof error !== "object") {
		return undefined;
	}

	if (
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
	) {
		return (error as { code: string }).code;
	}

	if ("cause" in error) {
		return extractPgCode((error as { cause?: unknown }).cause);
	}

	return undefined;
}

export function safeQuery<T>(
	operation: () => Promise<T>,
	context: { operation: string; table?: string },
): ResultAsync<T, DbError> {
	return ResultAsync.fromPromise(operation(), (error) =>
		dbError({
			operation: context.operation,
			table: context.table,
			message: error instanceof Error ? error.message : String(error),
			code: extractPgCode(error),
			cause: error,
		}),
	);
}

export { isDeadlock, isUniqueViolation };
