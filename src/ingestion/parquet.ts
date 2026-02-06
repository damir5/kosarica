import { mkdir } from "node:fs/promises";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { PARQUET_COMPRESSION_METHODS } from "@dsnp/parquetjs/dist/lib/compression";
import type { ParquetCompression } from "@dsnp/parquetjs/dist/parquet";
import {
	ParquetSchema,
	ParquetWriter,
	type WriterOptions,
} from "@dsnp/parquetjs/dist/parquet";
import { resolveStoragePath } from "@/lib/storage";

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
	appendRows(rows: ParquetPriceRow[]): Promise<void>;
	close(): Promise<{ filePath: string; rowCount: number }>;
}

async function openParquetWriter(
	filePath: string,
): Promise<ParquetWriter> {
	const options: WriterOptions = {};
	return ParquetWriter.openFile(PRICE_SCHEMA, filePath, options);
}

export async function createPricesParquetAppender(
	storageKey: string,
): Promise<PricesParquetAppender> {
	const filePath = resolveStoragePath(storageKey);
	await mkdir(path.dirname(filePath), { recursive: true });

	const writer = await openParquetWriter(filePath);
	let rowCount = 0;
	let closed = false;
	let writeQueue: Promise<void> = Promise.resolve();

	const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
		const next = writeQueue.then(operation);
		writeQueue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	};

	return {
		async appendRows(rows: ParquetPriceRow[]): Promise<void> {
			if (rows.length === 0) {
				return;
			}

			await enqueue(async () => {
				if (closed) {
					throw new Error("Cannot append rows after parquet writer is closed");
				}

				for (const row of rows) {
					await writer.appendRow(row as Record<string, unknown>);
				}
				rowCount += rows.length;
			});
		},

		async close(): Promise<{ filePath: string; rowCount: number }> {
			return enqueue(async () => {
				if (!closed) {
					await writer.close();
					closed = true;
				}
				return { filePath, rowCount };
			});
		},
	};
}

export async function writePricesParquet(
	storageKey: string,
	rows: ParquetPriceRow[],
): Promise<{ filePath: string; rowCount: number }> {
	const appender = await createPricesParquetAppender(storageKey);
	await appender.appendRows(rows);
	return appender.close();
}
