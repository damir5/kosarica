import { mkdir } from "node:fs/promises";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { PARQUET_COMPRESSION_METHODS } from "@dsnp/parquetjs/dist/lib/compression";
import type { ParquetCompression } from "@dsnp/parquetjs/dist/parquet";
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs/dist/parquet";
import { resolveStoragePath } from "@/lib/storage";

export interface ParquetPriceRow {
	target_date: Date;
	chain_slug: string;
	store_id: string;
	retailer_item_id: string;
	external_id?: string | null;
	name: string;
	barcode?: string | null;
	price_cents: number;
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
	price_cents: { type: "INT32", compression: PARQUET_COMPRESSION },
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

export async function writePricesParquet(
	storageKey: string,
	rows: ParquetPriceRow[],
): Promise<{ filePath: string; rowCount: number }> {
	const filePath = resolveStoragePath(storageKey);
	await mkdir(path.dirname(filePath), { recursive: true });

	const writer = await ParquetWriter.openFile(PRICE_SCHEMA, filePath, {});

	try {
		for (const row of rows) {
			await writer.appendRow(row as Record<string, unknown>);
		}
	} finally {
		await writer.close();
	}

	return { filePath, rowCount: rows.length };
}
