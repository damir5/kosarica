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

export type AppError = DbError | FetchError | StorageError;

export function dbError(opts: Omit<DbError, "_tag">): DbError {
	return { _tag: "DbError", ...opts };
}

export function fetchError(opts: Omit<FetchError, "_tag">): FetchError {
	return { _tag: "FetchError", ...opts };
}

export function storageError(opts: Omit<StorageError, "_tag">): StorageError {
	return { _tag: "StorageError", ...opts };
}

export function isDeadlock(e: DbError): boolean {
	return e.code === "40P01";
}

export function isUniqueViolation(e: DbError): boolean {
	return e.code === "23505";
}

export function toLogContext(e: AppError): Record<string, unknown> {
	const { cause, ...rest } = e;
	return {
		...rest,
		errorTag: e._tag,
		cause: cause !== undefined ? serializeError(cause) : undefined,
	};
}

export function errorToHttpStatus(e: AppError): number {
	switch (e._tag) {
		case "DbError":
			return isUniqueViolation(e) ? 409 : 500;
		case "FetchError":
			return 502;
		case "StorageError":
			return 500;
	}
}

