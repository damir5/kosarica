import { mkdir } from "node:fs/promises";
import path from "node:path";
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

const PRICE_SCHEMA = new ParquetSchema({
	target_date: { type: "DATE", compression: "SNAPPY" },
	chain_slug: { type: "UTF8", compression: "SNAPPY" },
	store_id: { type: "UTF8", compression: "SNAPPY" },
	retailer_item_id: { type: "UTF8", compression: "SNAPPY" },
	external_id: { type: "UTF8", optional: true, compression: "SNAPPY" },
	name: { type: "UTF8", compression: "SNAPPY" },
	barcode: { type: "UTF8", optional: true, compression: "SNAPPY" },
	price_cents: { type: "INT32", compression: "SNAPPY" },
	discount_price_cents: {
		type: "INT32",
		optional: true,
		compression: "SNAPPY",
	},
	unit_price_cents: { type: "INT32", optional: true, compression: "SNAPPY" },
	category: { type: "UTF8", optional: true, compression: "SNAPPY" },
	brand: { type: "UTF8", optional: true, compression: "SNAPPY" },
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
