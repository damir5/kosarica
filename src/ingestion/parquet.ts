import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { PARQUET_COMPRESSION_METHODS } from "@dsnp/parquetjs/dist/lib/compression";
import type { ParquetCompression } from "@dsnp/parquetjs/dist/parquet";
import {
	ParquetSchema,
	ParquetWriter,
	type WriterOptions,
} from "@dsnp/parquetjs/dist/parquet";
import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { getStorage, LocalStorage, resolveStoragePath } from "@/lib/storage";
import { storageError, type StorageError } from "@/lib/errors";

export interface ParquetPriceRow {
	target_date: Date;
	chain_slug: string;
	store_id: string;
	retailer_item_id: string;
	external_id?: string | null;
	name: string;
	barcode?: string | null;
	price_cents?: number | null;
	price_status: "available" | "unavailable";
	price_unavailable_reason?: "missing" | "invalid" | "non_positive" | null;
	discount_price_cents?: number | null;
	unit_price_cents?: number | null;
	category?: string | null;
	brand?: string | null;
	[key: string]: unknown; // Index signature for ParquetWriter compatibility
}

// parquetjs supports ZSTD in parquet metadata, but its TS type and method map lag behind.
const PARQUET_COMPRESSION = "ZSTD" as unknown as ParquetCompression;

function toBuffer(value: unknown): Buffer {
	if (Buffer.isBuffer(value)) {
		return value;
	}
	if (value instanceof Uint8Array) {
		return Buffer.from(value);
	}
	throw new TypeError("Expected Buffer or Uint8Array for parquet compression");
}

if (!("ZSTD" in PARQUET_COMPRESSION_METHODS)) {
	PARQUET_COMPRESSION_METHODS.ZSTD = {
		deflate: (value: unknown) => zstdCompressSync(toBuffer(value)),
		inflate: async (value: unknown) => zstdDecompressSync(toBuffer(value)),
	};
}

const PRICE_SCHEMA = new ParquetSchema({
	target_date: { type: "DATE", compression: PARQUET_COMPRESSION },
	chain_slug: { type: "UTF8", compression: PARQUET_COMPRESSION },
	store_id: { type: "UTF8", compression: PARQUET_COMPRESSION },
	retailer_item_id: { type: "UTF8", compression: PARQUET_COMPRESSION },
	external_id: {
		type: "UTF8",
		optional: true,
		compression: PARQUET_COMPRESSION,
	},
	name: { type: "UTF8", compression: PARQUET_COMPRESSION },
	barcode: { type: "UTF8", optional: true, compression: PARQUET_COMPRESSION },
	price_cents: {
		type: "INT32",
		optional: true,
		compression: PARQUET_COMPRESSION,
	},
	price_status: { type: "UTF8", compression: PARQUET_COMPRESSION },
	price_unavailable_reason: {
		type: "UTF8",
		optional: true,
		compression: PARQUET_COMPRESSION,
	},
	discount_price_cents: {
		type: "INT32",
		optional: true,
		compression: PARQUET_COMPRESSION,
	},
	unit_price_cents: {
		type: "INT32",
		optional: true,
		compression: PARQUET_COMPRESSION,
	},
	category: { type: "UTF8", optional: true, compression: PARQUET_COMPRESSION },
	brand: { type: "UTF8", optional: true, compression: PARQUET_COMPRESSION },
});

export interface PricesParquetAppender {
	appendRows(rows: ParquetPriceRow[]): ResultAsync<void, StorageError>;
	close(): ResultAsync<{ filePath: string; rowCount: number }, StorageError>;
}

function openParquetWriter(
	filePath: string,
): ResultAsync<ParquetWriter, StorageError> {
	const options: WriterOptions = {};
	return ResultAsync.fromPromise(
		ParquetWriter.openFile(PRICE_SCHEMA, filePath, options),
		(e) =>
			storageError({
				operation: "put",
				key: filePath,
				message: e instanceof Error ? e.message : "Failed to open parquet writer",
				cause: e,
			}),
	);
}

interface ParquetOutputTarget {
	filePath: string;
	persist(storageKey: string): Promise<void>;
	cleanup(): Promise<void>;
}

function createOutputTarget(
	storageKey: string,
): ResultAsync<ParquetOutputTarget, StorageError> {
	const storage = getStorage();

	if (storage instanceof LocalStorage) {
		const filePath = resolveStoragePath(storageKey);
		return ResultAsync.fromPromise(
			mkdir(path.dirname(filePath), { recursive: true }),
			(e) =>
				storageError({
					operation: "put",
					key: storageKey,
					message:
						e instanceof Error ? e.message : "Failed to create directory",
					cause: e,
				}),
		).map(() => ({
			filePath,
			async persist() {
				// No-op: writer already persisted directly to local storage path.
			},
			async cleanup() {
				// No-op for local direct writes.
			},
		}));
	}

	return ResultAsync.fromPromise(
		mkdtemp(path.join(tmpdir(), "kosarica-parquet-")),
		(e) =>
			storageError({
				operation: "put",
				key: storageKey,
				message:
					e instanceof Error ? e.message : "Failed to create temp directory",
				cause: e,
			}),
	).andThen((tempDir) => {
		const filePath = path.join(tempDir, "prices.parquet");
		return ResultAsync.fromPromise(
			mkdir(path.dirname(filePath), { recursive: true }),
			(e) =>
				storageError({
					operation: "put",
					key: storageKey,
					message:
						e instanceof Error ? e.message : "Failed to create directory",
					cause: e,
				}),
		).map(() => ({
			filePath,
			async persist(key: string) {
				const data = await readFile(filePath);
				await storage.put(key, data, {
					contentType: "application/octet-stream",
					originalName: path.basename(key),
					custom: {
						file_type: "parquet",
					},
				});
			},
			async cleanup() {
				await rm(tempDir, { recursive: true, force: true });
			},
		}));
	});
}

export function createPricesParquetAppender(
	storageKey: string,
): ResultAsync<PricesParquetAppender, StorageError> {
	return createOutputTarget(storageKey).andThen((target) => {
		const filePath = target.filePath;

		return openParquetWriter(filePath).map((writer) => {
			let rowCount = 0;
			let closed = false;
			let persisted = false;
			let cleanedUp = false;
			let writeQueue: Promise<void> = Promise.resolve();

			const enqueue = <T>(operation: () => ResultAsync<T, StorageError>): ResultAsync<T, StorageError> => {
				const deferred = new Promise<{ result: T } | { error: StorageError }>((resolve) => {
					writeQueue = writeQueue.then(
						() => operation().match(
							(result) => resolve({ result }),
							(error) => resolve({ error }),
						),
						(error) => resolve({ error: storageError({ operation: "put", key: storageKey, message: error instanceof Error ? error.message : "Queue error", cause: error }) }),
					);
				});
				return ResultAsync.fromPromise(deferred, () => storageError({ operation: "put", key: storageKey, message: "Queue error" })).andThen((result) =>
					"error" in result ? errAsync(result.error) : okAsync(result.result)
				);
			};

			return {
				appendRows(rows: ParquetPriceRow[]): ResultAsync<void, StorageError> {
					if (rows.length === 0) {
						return okAsync(undefined);
					}

					return enqueue(() => ResultAsync.fromPromise(
						(async () => {
							if (closed) {
								return err(storageError({
									operation: "put",
									key: storageKey,
									message: "Cannot append rows after parquet writer is closed",
								}));
							}

							for (const row of rows) {
								await writer.appendRow(row as Record<string, unknown>);
							}
							rowCount += rows.length;
							return ok(undefined);
						})(),
						(e) =>
							storageError({
								operation: "put",
								key: storageKey,
								message: e instanceof Error ? e.message : "Failed to append rows",
								cause: e,
							}),
					).andThen((result) => result));
				},

				close(): ResultAsync<{ filePath: string; rowCount: number }, StorageError> {
				return enqueue(() => ResultAsync.fromPromise(
					(async () => {
						if (!closed) {
							await writer.close();
							closed = true;
						}
						if (!persisted) {
							try {
								await target.persist(storageKey);
								persisted = true;
							} finally {
								if (!cleanedUp) {
									await target.cleanup();
									cleanedUp = true;
								}
							}
						}
						return ok({ filePath, rowCount });
					})(),
					(e) =>
						storageError({
							operation: "put",
							key: storageKey,
							message: e instanceof Error ? e.message : "Failed to close parquet writer",
							cause: e,
						}),
				).andThen((result) => result));
				},
			};
		});
	});
}

export function writePricesParquet(
	storageKey: string,
	rows: ParquetPriceRow[],
): ResultAsync<{ filePath: string; rowCount: number }, StorageError> {
	return createPricesParquetAppender(storageKey).andThen((appender) =>
		appender.appendRows(rows).andThen(() => appender.close()),
	);
}
