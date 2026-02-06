import { ResultAsync } from "neverthrow";
import { type StorageError, storageError } from "./errors";
import type { FileInfo, Storage, StorageMetadata } from "./storage";

export interface SafeStorage {
	get(key: string): ResultAsync<Buffer, StorageError>;
	put(
		key: string,
		data: Buffer,
		metadata?: StorageMetadata,
	): ResultAsync<void, StorageError>;
	delete(key: string): ResultAsync<void, StorageError>;
	exists(key: string): ResultAsync<boolean, StorageError>;
	list(prefix: string): ResultAsync<string[], StorageError>;
	getInfo(key: string): ResultAsync<FileInfo, StorageError>;
	getChecksum(key: string): ResultAsync<string, StorageError>;
}

export function createSafeStorage(storage: Storage): SafeStorage {
	const wrap = <T>(
		operation: StorageError["operation"],
		key: string,
		fn: () => Promise<T>,
	): ResultAsync<T, StorageError> =>
		ResultAsync.fromPromise(fn(), (error) =>
			storageError({
				operation,
				key,
				message: error instanceof Error ? error.message : String(error),
				cause: error,
			}),
		);

	return {
		get: (key) => wrap("get", key, () => storage.get(key)),
		put: (key, data, metadata) =>
			wrap("put", key, () => storage.put(key, data, metadata)),
		delete: (key) => wrap("delete", key, () => storage.delete(key)),
		exists: (key) => wrap("exists", key, () => storage.exists(key)),
		list: (prefix) => wrap("list", prefix, () => storage.list(prefix)),
		getInfo: (key) => wrap("getInfo", key, () => storage.getInfo(key)),
		getChecksum: (key) =>
			wrap("getChecksum", key, () => storage.getChecksum(key)),
	};
}
