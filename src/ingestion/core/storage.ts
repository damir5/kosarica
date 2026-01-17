/**
 * Storage Abstraction for Ingestion Pipeline
 *
 * Provides a unified interface for storing and retrieving files.
 * Currently uses local filesystem storage. Can be extended with
 * S3-compatible storage in the future.
 */

// ============================================================================
// SHA256 Hash Utility
// ============================================================================

/**
 * Compute SHA256 hash of data using Web Crypto API.
 * Works in both Node.js and Cloudflare Workers.
 *
 * @param data - Data to hash (string or ArrayBuffer)
 * @returns Hex-encoded SHA256 hash
 */
export async function computeSha256(
	data: string | ArrayBuffer | Uint8Array,
): Promise<string> {
	let buffer: ArrayBuffer;
	if (typeof data === "string") {
		buffer = new TextEncoder().encode(data).buffer as ArrayBuffer;
	} else if (data instanceof Uint8Array) {
		buffer = data.buffer as ArrayBuffer;
	} else {
		buffer = data;
	}

	const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
	const hashArray = new Uint8Array(hashBuffer);
	return Array.from(hashArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Metadata for a stored object.
 */
export interface StorageMetadata {
	/** Object key */
	key: string;
	/** Size in bytes */
	size: number;
	/** Last modified timestamp */
	lastModified: Date;
	/** Content SHA256 hash, if available */
	sha256?: string;
	/** Custom metadata */
	customMetadata?: Record<string, string>;
}

/**
 * Options for put operations.
 */
export interface PutOptions {
	/** Custom metadata to attach */
	customMetadata?: Record<string, string>;
	/** SHA256 hash to store with object */
	sha256?: string;
}

/**
 * Result of a get operation.
 */
export interface GetResult {
	/** Object content */
	content: ArrayBuffer;
	/** Object metadata */
	metadata: StorageMetadata;
}

/**
 * Storage interface for the ingestion pipeline.
 * Abstracts local filesystem and Cloudflare R2 operations.
 */
export interface Storage {
	/**
	 * Get an object by key.
	 * @param key - Object key
	 * @returns Object content and metadata, or null if not found
	 */
	get(key: string): Promise<GetResult | null>;

	/**
	 * Put an object.
	 * @param key - Object key
	 * @param content - Object content
	 * @param options - Put options
	 * @returns Object metadata after storage
	 */
	put(
		key: string,
		content: ArrayBuffer | Uint8Array | string,
		options?: PutOptions,
	): Promise<StorageMetadata>;

	/**
	 * Delete an object.
	 * @param key - Object key
	 * @returns True if deleted, false if not found
	 */
	delete(key: string): Promise<boolean>;

	/**
	 * Check if an object exists.
	 * @param key - Object key
	 * @returns True if exists
	 */
	exists(key: string): Promise<boolean>;

	/**
	 * Get object metadata without fetching content.
	 * @param key - Object key
	 * @returns Object metadata, or null if not found
	 */
	head(key: string): Promise<StorageMetadata | null>;

	/**
	 * List objects with a given prefix.
	 * @param prefix - Key prefix to filter by
	 * @returns List of object metadata
	 */
	list(prefix: string): Promise<StorageMetadata[]>;
}

// ============================================================================
// Local Filesystem Storage
// ============================================================================

/**
 * Local filesystem storage implementation.
 * Used for CLI commands and local development.
 */
export class LocalStorage implements Storage {
	private basePath: string;
	private fs: typeof import("node:fs/promises") | null = null;
	private path: typeof import("node:path") | null = null;

	constructor(basePath: string) {
		this.basePath = basePath;
	}

	private async ensureModules(): Promise<{
		fs: typeof import("node:fs/promises");
		path: typeof import("node:path");
	}> {
		if (!this.fs || !this.path) {
			// Dynamic import for Node.js modules (not available in Workers)
			this.fs = await import("node:fs/promises");
			this.path = await import("node:path");
		}
		return { fs: this.fs, path: this.path };
	}

	private async resolvePath(key: string): Promise<string> {
		const { path } = await this.ensureModules();
		return path.join(this.basePath, key);
	}

	async get(key: string): Promise<GetResult | null> {
		const { fs } = await this.ensureModules();
		const filePath = await this.resolvePath(key);

		try {
			const [content, stat] = await Promise.all([
				fs.readFile(filePath),
				fs.stat(filePath),
			]);

			return {
				content: content.buffer.slice(
					content.byteOffset,
					content.byteOffset + content.byteLength,
				) as ArrayBuffer,
				metadata: {
					key,
					size: stat.size,
					lastModified: stat.mtime,
				},
			};
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return null;
			}
			throw error;
		}
	}

	async put(
		key: string,
		content: ArrayBuffer | Uint8Array | string,
		options?: PutOptions,
	): Promise<StorageMetadata> {
		const { fs, path } = await this.ensureModules();
		const filePath = await this.resolvePath(key);

		// Ensure directory exists
		const dir = path.dirname(filePath);
		await fs.mkdir(dir, { recursive: true });

		// Convert content to Buffer
		let buffer: Buffer;
		if (typeof content === "string") {
			buffer = Buffer.from(content, "utf-8");
		} else if (content instanceof Uint8Array) {
			buffer = Buffer.from(content);
		} else {
			buffer = Buffer.from(content);
		}

		await fs.writeFile(filePath, buffer);

		// Write metadata file if custom metadata provided
		if (options?.customMetadata || options?.sha256) {
			const metadataPath = `${filePath}.meta.json`;
			await fs.writeFile(
				metadataPath,
				JSON.stringify({
					sha256: options.sha256,
					customMetadata: options.customMetadata,
				}),
			);
		}

		const stat = await fs.stat(filePath);
		return {
			key,
			size: stat.size,
			lastModified: stat.mtime,
			sha256: options?.sha256,
			customMetadata: options?.customMetadata,
		};
	}

	async delete(key: string): Promise<boolean> {
		const { fs } = await this.ensureModules();
		const filePath = await this.resolvePath(key);

		try {
			await fs.unlink(filePath);
			// Also delete metadata file if exists
			try {
				await fs.unlink(`${filePath}.meta.json`);
			} catch {
				// Metadata file may not exist
			}
			return true;
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return false;
			}
			throw error;
		}
	}

	async exists(key: string): Promise<boolean> {
		const { fs } = await this.ensureModules();
		const filePath = await this.resolvePath(key);

		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	async head(key: string): Promise<StorageMetadata | null> {
		const { fs } = await this.ensureModules();
		const filePath = await this.resolvePath(key);

		try {
			const stat = await fs.stat(filePath);
			const metadata: StorageMetadata = {
				key,
				size: stat.size,
				lastModified: stat.mtime,
			};

			// Try to read metadata file
			try {
				const metaContent = await fs.readFile(`${filePath}.meta.json`, "utf-8");
				const meta = JSON.parse(metaContent);
				if (meta.sha256) metadata.sha256 = meta.sha256;
				if (meta.customMetadata) metadata.customMetadata = meta.customMetadata;
			} catch {
				// Metadata file may not exist
			}

			return metadata;
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return null;
			}
			throw error;
		}
	}

	async list(prefix: string): Promise<StorageMetadata[]> {
		const { fs, path } = await this.ensureModules();
		const results: StorageMetadata[] = [];

		const listDir = async (dir: string, keyPrefix: string): Promise<void> => {
			try {
				const entries = await fs.readdir(dir, { withFileTypes: true });

				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name);
					const key = path.join(keyPrefix, entry.name);

					if (entry.isDirectory()) {
						await listDir(fullPath, key);
					} else if (!entry.name.endsWith(".meta.json")) {
						if (key.startsWith(prefix)) {
							const stat = await fs.stat(fullPath);
							results.push({
								key,
								size: stat.size,
								lastModified: stat.mtime,
							});
						}
					}
				}
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
				) {
					throw error;
				}
			}
		};

		await listDir(this.basePath, "");
		return results;
	}
}

// ============================================================================
// Storage Factory
// ============================================================================

/**
 * Create a storage instance using environment configuration.
 * Uses STORAGE_PATH environment variable for the base directory.
 *
 * @returns LocalStorage instance configured for the environment
 */
export function createStorage(): Storage {
	const basePath = process.env.STORAGE_PATH || "./data/storage";
	return new LocalStorage(basePath);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a storage key for ingestion files.
 *
 * @param runId - Ingestion run ID
 * @param chainSlug - Chain identifier
 * @param filename - Original filename
 * @param suffix - Optional suffix (e.g., 'parsed.json')
 * @returns Storage key
 */
export function generateStorageKey(
	runId: string,
	chainSlug: string,
	filename: string,
	suffix?: string,
): string {
	const parts = ["ingestion", runId, chainSlug, filename];
	if (suffix) {
		parts.push(suffix);
	}
	return parts.join("/");
}

/**
 * Check if content already exists by SHA256 hash.
 *
 * @param storage - Storage instance
 * @param prefix - Key prefix to search
 * @param sha256 - Hash to check for
 * @returns Existing object metadata if found, null otherwise
 */
export async function findByHash(
	storage: Storage,
	prefix: string,
	sha256: string,
): Promise<StorageMetadata | null> {
	const objects = await storage.list(prefix);

	for (const obj of objects) {
		const metadata = await storage.head(obj.key);
		if (metadata?.sha256 === sha256) {
			return metadata;
		}
	}

	return null;
}
