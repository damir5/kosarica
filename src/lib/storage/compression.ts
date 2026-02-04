import type { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
	createGunzip,
	createGzip,
	gunzip as gunzipCallback,
	gzip as gzipCallback,
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
		case "txt":
		case "html":
			return true; // Plain text - compress
		case "xlsx":
		case "xls":
			return false; // Already compressed (ZIP-based)
		case "zip":
		case "gz":
		case "gzip":
		case "bz2":
		case "xz":
		case "zst":
		case "7z":
		case "rar":
			return false; // Already compressed
		case "jpg":
		case "jpeg":
		case "png":
		case "gif":
		case "webp":
		case "mp4":
		case "mp3":
		case "pdf":
			return false; // Media files - already compressed or binary
		default:
			return false; // Don't compress unknown types
	}
}

/**
 * Check if a filename indicates the file is already compressed.
 * Checks common compression extensions.
 */
export function isAlreadyCompressed(filename: string): boolean {
	const lowerFilename = filename.toLowerCase();
	return (
		lowerFilename.endsWith(".gz") ||
		lowerFilename.endsWith(".gzip") ||
		lowerFilename.endsWith(".zip") ||
		lowerFilename.endsWith(".bz2") ||
		lowerFilename.endsWith(".xz") ||
		lowerFilename.endsWith(".zst") ||
		lowerFilename.endsWith(".7z") ||
		lowerFilename.endsWith(".rar") ||
		lowerFilename.endsWith(".tar.gz") ||
		lowerFilename.endsWith(".tgz")
	);
}

/**
 * Detect file type from filename extension.
 * Returns the file type (without dot) or null if unknown.
 */
export function detectFileType(filename: string): string | null {
	const lowerFilename = filename.toLowerCase();

	// Check for double extensions first (e.g., .tar.gz)
	if (lowerFilename.endsWith(".tar.gz") || lowerFilename.endsWith(".tgz")) {
		return "gz";
	}

	// Single extension
	const lastDot = lowerFilename.lastIndexOf(".");
	if (lastDot === -1 || lastDot === lowerFilename.length - 1) {
		return null;
	}

	return lowerFilename.slice(lastDot + 1);
}

/**
 * Smart compression decision based on file type and current state.
 * Returns true if the file should be compressed.
 *
 * @param filename - Original filename
 * @param fileType - Detected file type (from metadata or detection)
 * @returns true if the file should be compressed
 */
export function shouldCompressSmart(
	filename: string,
	fileType?: string,
): boolean {
	// If already compressed by extension, don't compress
	if (isAlreadyCompressed(filename)) {
		return false;
	}

	// If file type is provided, use it
	if (fileType) {
		return shouldCompress(fileType);
	}

	// Try to detect from filename
	const detectedType = detectFileType(filename);
	if (detectedType) {
		return shouldCompress(detectedType);
	}

	// Unknown type - don't compress
	return false;
}
