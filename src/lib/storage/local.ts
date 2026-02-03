import { createReadStream, createWriteStream } from "node:fs";
import {
	mkdir,
	readFile,
	rm,
	stat,
	writeFile,
	readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import * as path from "node:path";
import type { FileInfo, Storage, StorageMetadata } from "./index";
import { compressGzip, decompressGzip, shouldCompress } from "./compression";

/** Minimum size in bytes before compression is attempted */
export const MIN_COMPRESSION_SIZE = 1024; // 1KB

/**
 * LocalStorage implements the Storage interface using local filesystem.
 * Matches Go implementation in services/price-service/internal/storage/local.go
 */
export class LocalStorage implements Storage {
	constructor(private basePath: string) {}

	/**
	 * Store content at the given key with optional metadata.
	 * Compresses data if applicable based on file type and size.
	 */
	async put(
		key: string,
		data: Buffer,
		metadata?: StorageMetadata,
	): Promise<void> {
		const fullPath = this.keyToPath(key);

		// Ensure parent directory exists
		const dir = path.dirname(fullPath);
		await mkdir(dir, { recursive: true });

		let dataToStore = data;
		let compressed = false;
		let storePath = fullPath;

		// Determine if we should compress
		if (metadata && data.length >= MIN_COMPRESSION_SIZE) {
			const fileType = metadata.custom?.file_type || "";
			if (shouldCompress(fileType)) {
				const compressedData = await compressGzip(data);
				if (compressedData.length < data.length) {
					dataToStore = compressedData;
					compressed = true;
					storePath = `${fullPath}.gz`;
				}
			}
		}

		// Update metadata with compression info
		if (metadata) {
			if (!metadata.custom) {
				metadata.custom = {};
			}
			if (compressed) {
				metadata.custom.compressed = "true";
				metadata.custom.original_size = String(data.length);
				metadata.compressedSize = dataToStore.length;
			}
		}

		// Write content file
		await writeFile(storePath, dataToStore);

		// Write metadata sidecar file if metadata is provided
		if (metadata) {
			const metaPath = `${fullPath}.meta.json`;
			await writeFile(metaPath, JSON.stringify(metadata));
		}
	}

	/**
	 * Store content using streaming compression directly to file.
	 * More memory-efficient for large files.
	 */
	async putStreaming(
		key: string,
		data: Buffer,
		metadata?: StorageMetadata,
	): Promise<void> {
		const fullPath = this.keyToPath(key);

		// Ensure parent directory exists
		const dir = path.dirname(fullPath);
		await mkdir(dir, { recursive: true });

		// Determine if we should compress
		const shouldCompressFile =
			metadata &&
			data.length >= MIN_COMPRESSION_SIZE &&
			shouldCompress(metadata.custom?.file_type || "");

		if (shouldCompressFile) {
			const storePath = `${fullPath}.gz`;
			const readStream = Readable.from(data);
			const writeStream = createWriteStream(storePath);
			await pipeline(readStream, createGzip(), writeStream);

			// Update metadata
			if (metadata) {
				if (!metadata.custom) {
					metadata.custom = {};
				}
				metadata.custom.compressed = "true";
				metadata.custom.original_size = String(data.length);
				const stats = await stat(storePath);
				metadata.compressedSize = stats.size;
			}
		} else {
			await writeFile(fullPath, data);
		}
	}

	/**
	 * Retrieve content from the given key.
	 * Automatically decompresses if stored as .gz file.
	 */
	async get(key: string): Promise<Buffer> {
		const fullPath = this.keyToPath(key);

		// Check if .gz version exists (compressed file)
		const gzPath = `${fullPath}.gz`;
		try {
			const stats = await stat(gzPath);
			if (stats.isFile()) {
				const content = await readFile(gzPath);
				return decompressGzip(content);
			}
		} catch {
			// .gz file doesn't exist, try uncompressed
		}

		// Fall back to uncompressed file
		try {
			return await readFile(fullPath);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`file not found: ${key}`);
			}
			throw err;
		}
	}

	/**
	 * Retrieve content using streaming decompression.
	 * More memory-efficient for large files.
	 */
	async getStreaming(key: string): Promise<Buffer> {
		const fullPath = this.keyToPath(key);

		// Check if .gz version exists (compressed file)
		const gzPath = `${fullPath}.gz`;
		try {
			const stats = await stat(gzPath);
			if (stats.isFile()) {
				const chunks: Buffer[] = [];
				const readStream = createReadStream(gzPath);
				await pipeline(readStream, createGunzip(), async function* (source) {
					for await (const chunk of source) {
						chunks.push(chunk as Buffer);
					}
				});
				return Buffer.concat(chunks);
			}
		} catch {
			// .gz file doesn't exist, try uncompressed
		}

		// Fall back to uncompressed file
		try {
			return await readFile(fullPath);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`file not found: ${key}`);
			}
			throw err;
		}
	}

	/**
	 * Retrieve file information without content.
	 */
	async getInfo(key: string): Promise<FileInfo> {
		const fullPath = this.keyToPath(key);

		// Check for compressed version first
		let actualPath = fullPath;
		let isCompressed = false;
		const gzPath = `${fullPath}.gz`;

		try {
			const gzStats = await stat(gzPath);
			if (gzStats.isFile()) {
				actualPath = gzPath;
				isCompressed = true;
			}
		} catch {
			// .gz file doesn't exist
		}

		try {
			const stats = await stat(actualPath);
			const checksum = await this.computeFileChecksum(actualPath);

			const info: FileInfo = {
				key,
				size: stats.size,
				checksum,
				modifiedAt: stats.mtime,
			};

			// Read metadata from sidecar file if it exists
			const metaPath = `${fullPath}.meta.json`;
			try {
				const metaContent = await readFile(metaPath, "utf-8");
				info.metadata = JSON.parse(metaContent) as StorageMetadata;
			} catch {
				// No metadata file, add compression info if applicable
				if (isCompressed) {
					info.metadata = {
						custom: { compressed: "true" },
					};
				}
			}

			return info;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`file not found: ${key}`);
			}
			throw err;
		}
	}

	/**
	 * Check if a file exists at the given key.
	 * Checks both uncompressed and .gz versions.
	 */
	async exists(key: string): Promise<boolean> {
		const fullPath = this.keyToPath(key);

		// Check for uncompressed file
		try {
			const stats = await stat(fullPath);
			if (stats.isFile()) {
				return true;
			}
		} catch {
			// File doesn't exist
		}

		// Check for compressed file
		const gzPath = `${fullPath}.gz`;
		try {
			const stats = await stat(gzPath);
			if (stats.isFile()) {
				return true;
			}
		} catch {
			// .gz file doesn't exist
		}

		return false;
	}

	/**
	 * Delete a file at the given key.
	 * Removes both uncompressed and .gz versions if they exist, plus metadata sidecar.
	 */
	async delete(key: string): Promise<void> {
		const fullPath = this.keyToPath(key);

		// Delete uncompressed content file
		try {
			await rm(fullPath);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err;
			}
		}

		// Delete compressed file if exists
		const gzPath = `${fullPath}.gz`;
		try {
			await rm(gzPath);
		} catch {
			// Ignore deletion errors for gz file
		}

		// Delete metadata sidecar file if exists
		const metaPath = `${fullPath}.meta.json`;
		try {
			await rm(metaPath);
		} catch {
			// Ignore deletion errors for metadata file
		}
	}

	/**
	 * List all keys matching the given prefix.
	 * Strips .gz suffix from compressed files.
	 */
	async list(prefix: string): Promise<string[]> {
		const searchPath = this.keyToPath(prefix);

		// Ensure search path exists or get parent directory
		let basePath = searchPath;
		try {
			const stats = await stat(searchPath);
			if (!stats.isDirectory()) {
				basePath = path.dirname(searchPath);
			}
		} catch {
			basePath = path.dirname(searchPath);
			try {
				await stat(basePath);
			} catch {
				return [];
			}
		}

		const keys: string[] = [];
		const seen = new Set<string>();

		await this.walkDir(basePath, async (filePath) => {
			// Convert path back to key, stripping .gz extension if present
			let key = this.pathToKey(filePath);
			if (key.endsWith(".gz")) {
				key = key.slice(0, -3);
			}

			// Filter by prefix and avoid duplicates
			if (key.startsWith(prefix) && !seen.has(key)) {
				seen.add(key);
				keys.push(key);
			}
		});

		return keys;
	}

	/**
	 * Get the checksum for a file.
	 * Returns SHA256 hash of the stored file (compressed or uncompressed).
	 */
	async getChecksum(key: string): Promise<string> {
		const fullPath = this.keyToPath(key);

		// Check for compressed version first
		const gzPath = `${fullPath}.gz`;
		try {
			const stats = await stat(gzPath);
			if (stats.isFile()) {
				return this.computeFileChecksum(gzPath);
			}
		} catch {
			// .gz file doesn't exist
		}

		return this.computeFileChecksum(fullPath);
	}

	/**
	 * Get the base path for this storage.
	 */
	getBasePath(): string {
		return this.basePath;
	}

	/**
	 * Convert a storage key to a filesystem path.
	 * Cleans the key to prevent path traversal attacks.
	 */
	private keyToPath(key: string): string {
		// Clean the key to prevent path traversal
		let cleanKey = path.normalize(key);
		cleanKey = cleanKey.replace(/^[/\\]+/, "");

		// Ensure no path traversal
		if (cleanKey.includes("..")) {
			throw new Error(`invalid key: path traversal detected in "${key}"`);
		}

		return path.join(this.basePath, cleanKey);
	}

	/**
	 * Convert a filesystem path to a storage key.
	 */
	private pathToKey(filePath: string): string {
		const relPath = path.relative(this.basePath, filePath);
		// Normalize to forward slashes for consistency
		return relPath.replace(/\\/g, "/");
	}

	/**
	 * Compute SHA256 checksum for a file using streaming.
	 */
	private async computeFileChecksum(filePath: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const hash = createHash("sha256");
			const stream = createReadStream(filePath);

			stream.on("data", (chunk) => hash.update(chunk));
			stream.on("end", () => resolve(hash.digest("hex")));
			stream.on("error", reject);
		});
	}

	/**
	 * Recursively walk a directory and call callback for each file.
	 */
	private async walkDir(
		dir: string,
		callback: (filePath: string) => Promise<void>,
	): Promise<void> {
		try {
			const entries = await readdir(dir, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await this.walkDir(fullPath, callback);
				} else if (entry.isFile()) {
					await callback(fullPath);
				}
			}
		} catch {
			// Directory doesn't exist or not accessible
		}
	}
}

/**
 * Compute SHA256 checksum for content.
 */
export function computeChecksum(content: Buffer): string {
	const hash = createHash("sha256");
	hash.update(content);
	return hash.digest("hex");
}
