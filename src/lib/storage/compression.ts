import { Readable, type Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
	createGunzip,
	createGzip,
	gzip as gzipCallback,
	gunzip as gunzipCallback,
} from "node:zlib";

const gzipAsync = promisify(gzipCallback);
const gunzipAsync = promisify(gunzipCallback);

/**
 * Compress data using gzip.
 * Uses the simple callback-based API which is reliable and efficient.
 */
export async function compressGzip(data: Buffer): Promise<Buffer> {
	return gzipAsync(data);
}

/**
 * Decompress gzip data.
 * Uses the simple callback-based API which is reliable and efficient.
 */
export async function decompressGzip(data: Buffer): Promise<Buffer> {
	return gunzipAsync(data);
}

/**
 * Compress data from a readable stream using gzip.
 */
export async function compressGzipStream(input: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	const gzip = createGzip();

	await pipeline(input, gzip, async function* (source: AsyncIterable<Buffer>) {
		for await (const chunk of source) {
			chunks.push(chunk);
			yield chunk;
		}
	} as unknown as Transform);

	return Buffer.concat(chunks);
}

/**
 * Decompress gzip data from a readable stream.
 */
export async function decompressGzipStream(input: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	const gunzip = createGunzip();

	await pipeline(input, gunzip, async function* (
		source: AsyncIterable<Buffer>,
	) {
		for await (const chunk of source) {
			chunks.push(chunk);
			yield chunk;
		}
	} as unknown as Transform);

	return Buffer.concat(chunks);
}

/**
 * Returns true if the file type should be compressed.
 * Matches Go implementation in services/price-service/internal/storage/compression.go
 */
export function shouldCompress(fileType: string): boolean {
	switch (fileType) {
		case "csv":
		case "xml":
		case "json":
			return true; // Plain text - compress
		case "xlsx":
		case "xls":
			return false; // Already compressed (ZIP-based)
		case "zip":
		case "gz":
		case "bz2":
		case "xz":
		case "zst":
			return false; // Already compressed
		default:
			return false; // Don't compress unknown types
	}
}
