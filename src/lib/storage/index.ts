import path from "node:path";
import { LocalStorage } from "./local";

/**
 * Metadata for stored files.
 * Matches Go storage.Metadata in services/price-service/internal/storage/interface.go
 */
export interface StorageMetadata {
	contentType?: string;
	originalName?: string;
	chainSlug?: string;
	sourceUrl?: string;
	downloadedAt?: Date;
	compressedSize?: number;
	custom?: Record<string, string>;
}

/**
 * Information about a stored file.
 * Matches Go storage.FileInfo in services/price-service/internal/storage/interface.go
 */
export interface FileInfo {
	key: string;
	size: number;
	checksum: string;
	contentType?: string;
	modifiedAt: Date;
	metadata?: StorageMetadata;
}

/**
 * Storage interface for file operations.
 * Matches Go storage.Storage in services/price-service/internal/storage/interface.go
 */
export interface Storage {
	/** Store content at the given key with optional metadata */
	put(key: string, data: Buffer, metadata?: StorageMetadata): Promise<void>;

	/** Retrieve content from the given key */
	get(key: string): Promise<Buffer>;

	/** Retrieve file information without content */
	getInfo(key: string): Promise<FileInfo>;

	/** Check if a file exists at the given key */
	exists(key: string): Promise<boolean>;

	/** Remove a file at the given key */
	delete(key: string): Promise<void>;

	/** Return all keys matching the given prefix */
	list(prefix: string): Promise<string[]>;

	/** Return the checksum for a file */
	getChecksum(key: string): Promise<string>;
}

// Singleton storage instance
let storageInstance: Storage | null = null;

/**
 * Get or create the storage instance.
 * Uses STORAGE_PATH environment variable for the base path.
 */
export function getStorage(): Storage {
	if (storageInstance) {
		return storageInstance;
	}

	const basePath = process.env.STORAGE_PATH;
	if (!basePath) {
		throw new Error("STORAGE_PATH environment variable is required");
	}

	storageInstance = new LocalStorage(basePath);
	return storageInstance;
}

/**
 * Create a new storage instance with a specific base path.
 * Useful for testing or CLI tools.
 */
export function createStorage(basePath: string): Storage {
	return new LocalStorage(basePath);
}

/**
 * Close the storage instance.
 * Clears the singleton for cleanup.
 */
export function closeStorage(): void {
	storageInstance = null;
}

// Key builders matching Go helpers in services/price-service/internal/storage/local.go

/**
 * Build a storage key for an archive file.
 * Format: archives/{chainSlug}/{date}/{filename}
 */
export function buildArchiveKey(
	chainSlug: string,
	date: Date,
	filename: string,
): string {
	const dateStr = formatDate(date);
	return `archives/${chainSlug}/${dateStr}/${filename}`;
}

/**
 * Build a storage key for an expanded file from a ZIP.
 * Format: expanded/{chainSlug}/{date}/{parentBase}/{innerFilename}
 *
 * DEPRECATED: Use buildTempExpandedKey() for new code.
 * This function is kept for backward compatibility with existing expanded files.
 */
export function buildExpandedKey(
	chainSlug: string,
	date: Date,
	parentFilename: string,
	innerFilename: string,
): string {
	const dateStr = formatDate(date);
	// Remove .zip extension from parent
	const parentBase = parentFilename.replace(/\.zip$/i, "");
	return `expanded/${chainSlug}/${dateStr}/${parentBase}/${innerFilename}`;
}

/**
 * Build a temporary storage key for an expanded file from a ZIP.
 * Format: temp/expanded/{timestamp}-{chainSlug}/{parentBase}/{innerFilename}
 *
 * The timestamp should be created once per ingestion run and reused for all
 * files extracted in that run.
 *
 * @param timestamp - Timestamp string (format: YYYYMMDD-HHmmss)
 * @param chainSlug - Chain identifier
 * @param parentFilename - Original ZIP filename
 * @param innerFilename - Extracted file name
 */
export function buildTempExpandedKey(
	timestamp: string,
	chainSlug: string,
	parentFilename: string,
	innerFilename: string,
): string {
	// Remove .zip extension from parent
	const parentBase = parentFilename.replace(/\.zip$/i, "");
	return `temp/expanded/${timestamp}-${chainSlug}/${parentBase}/${innerFilename}`;
}

/**
 * Build a storage key for a parquet file.
 * Format: parquet/{chainSlug}/{date}/prices.parquet
 */
export function buildParquetKey(chainSlug: string, date: Date): string {
	const dateStr = formatDate(date);
	return `parquet/${chainSlug}/${dateStr}/prices.parquet`;
}

/**
 * Resolve a storage key to a local filesystem path.
 * Only supported for LocalStorage.
 *
 * @throws {Error} If key contains path traversal sequences
 * @throws {Error} If storage is not LocalStorage
 */
export function resolveStoragePath(key: string): string {
	const storage = getStorage();
	if (!(storage instanceof LocalStorage)) {
		throw new Error("resolveStoragePath is only supported for LocalStorage");
	}

	// Check for path traversal BEFORE normalization
	if (key.includes("..")) {
		throw new Error(`invalid key: path traversal detected in "${key}"`);
	}

	let cleanKey = path.normalize(key);
	cleanKey = cleanKey.replace(/^[/\\]+/, "");

	return path.join(storage.getBasePath(), cleanKey);
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Format a date as a timestamp for directory names.
 * Format: YYYYMMDD-HHmmss
 */
export function formatTimestamp(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	const second = String(date.getSeconds()).padStart(2, "0");

	return `${year}${month}${day}-${hour}${minute}${second}`;
}

export {
	compressGzip,
	compressGzipStream,
	decompressGzip,
	decompressGzipStream,
	detectFileType,
	isAlreadyCompressed,
	shouldCompress,
	shouldCompressSmart,
} from "./compression";
// Re-export components
export { computeChecksum, LocalStorage, MIN_COMPRESSION_SIZE } from "./local";
// Re-export temp storage utilities
export {
	cleanupTempDirs,
	createTempDir,
	createTestTempDir,
	deleteTempDir,
	getTempStorageConfig,
	listAllTempDirs,
	listTempDirs,
	type TempDirInfo,
	type TempStorageConfig,
} from "./temp";
