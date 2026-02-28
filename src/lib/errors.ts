import { serializeError } from "serialize-error";

export interface DbError {
	readonly _tag: "DbError";
	readonly operation: string;
	readonly table?: string;
	readonly message: string;
	readonly code?: string;
	readonly cause?: unknown;
}

export interface FetchError {
	readonly _tag: "FetchError";
	readonly url: string;
	readonly status?: number;
	readonly message: string;
	readonly retryable: boolean;
	readonly attempts: number;
	readonly cause?: unknown;
}

export interface StorageError {
	readonly _tag: "StorageError";
	readonly operation:
		| "get"
		| "put"
		| "delete"
		| "list"
		| "exists"
		| "getInfo"
		| "getChecksum";
	readonly key: string;
	readonly message: string;
	readonly cause?: unknown;
}

export interface NotFoundError {
	readonly _tag: "NotFoundError";
	readonly entity: string;
	readonly identifier: string;
	readonly message: string;
}

export interface ValidationError {
	readonly _tag: "ValidationError";
	readonly field?: string;
	readonly message: string;
	readonly value?: unknown;
}

export interface LlmError {
	readonly _tag: "LlmError";
	readonly provider: string;
	readonly message: string;
	readonly cause?: unknown;
}

export type AppError = DbError | FetchError | StorageError | NotFoundError | ValidationError | LlmError;

export function dbError(opts: Omit<DbError, "_tag">): DbError {
	return { _tag: "DbError", ...opts };
}

export function fetchError(opts: Omit<FetchError, "_tag">): FetchError {
	return { _tag: "FetchError", ...opts };
}

export function storageError(opts: Omit<StorageError, "_tag">): StorageError {
return { _tag: "StorageError", ...opts };
}

export function notFoundError(opts: Omit<NotFoundError, "_tag">): NotFoundError {
	return { _tag: "NotFoundError", ...opts };
}

export function validationError(opts: Omit<ValidationError, "_tag">): ValidationError {
	return { _tag: "ValidationError", ...opts };
}

export function llmError(opts: Omit<LlmError, "_tag">): LlmError {
	return { _tag: "LlmError", ...opts };
}

export function isDeadlock(e: DbError): boolean {
	return e.code === "40P01";
}

export function isUniqueViolation(e: DbError): boolean {
	return e.code === "23505";
}

export function toLogContext(e: AppError): Record<string, unknown> {
	const { _tag, ...rest } = e;
	const result: Record<string, unknown> = {
		...rest,
		errorTag: _tag,
	};
	if ("cause" in e && e.cause !== undefined) {
		result.cause = serializeError(e.cause);
	}
	return result;
}

/**
 * Maps an AppError to the appropriate HTTP status code for oRPC error responses.
 */
export function errorToHttpStatus(e: AppError): number {
	switch (e._tag) {
		case "NotFoundError":
			return 404;
		case "ValidationError":
			return 400;
		case "DbError":
			return isUniqueViolation(e) ? 409 : 500;
		case "FetchError":
			return 502;
		case "StorageError":
			return 500;
		case "LlmError":
			return 502;
	}
}

