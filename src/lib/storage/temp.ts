import { mkdir, readdir, rm, stat } from "node:fs/promises";
import * as path from "node:path";

/**
 * Temporary storage utilities for intermediate processing files.
 * All temp files include creation timestamps for garbage collection.
 */

export interface TempStorageConfig {
	/** Base path for temporary storage (from TEMP_STORAGE_PATH env var) */
	basePath: string;
	/** Retention period in hours (from TEMP_FILE_RETENTION_HOURS env var) */
	retentionHours: number;
}

export interface TempDirInfo {
	/** Full path to the temp directory */
	path: string;
	/** Directory name */
	name: string;
	/** Creation timestamp parsed from directory name */
	createdAt: Date;
	/** Size in bytes */
	sizeBytes: number;
	/** Age in hours */
	ageHours: number;
	/** Whether this directory is eligible for cleanup */
	shouldCleanup: boolean;
}

/**
 * Get temporary storage configuration from environment.
 */
export function getTempStorageConfig(): TempStorageConfig {
	const basePath = process.env.TEMP_STORAGE_PATH || "./data/temp";
	const retentionHours = Number.parseInt(
		process.env.TEMP_FILE_RETENTION_HOURS || "48",
		10,
	);

	if (Number.isNaN(retentionHours) || retentionHours <= 0) {
		throw new Error(
			`Invalid TEMP_FILE_RETENTION_HOURS: ${process.env.TEMP_FILE_RETENTION_HOURS}`,
		);
	}

	return { basePath, retentionHours };
}

/**
 * Create a timestamped temporary directory.
 * Format: {basePath}/{category}/{YYYYMMDD-HHmmss-purpose}
 *
 * @param category - Category of temp files (e.g., "expanded", "test")
 * @param purpose - Purpose identifier (e.g., chain slug, test name)
 * @returns Full path to the created directory
 *
 * @example
 * ```ts
 * const dir = await createTempDir("expanded", "konzum");
 * // Returns: ./data/temp/expanded/20260204-143022-konzum
 * ```
 */
export async function createTempDir(
	category: string,
	purpose: string,
): Promise<string> {
	const config = getTempStorageConfig();
	const timestamp = formatTimestamp(new Date());
	const dirName = `${timestamp}-${purpose}`;
	const fullPath = path.join(config.basePath, category, dirName);

	await mkdir(fullPath, { recursive: true });
	return fullPath;
}

/**
 * Create a temporary directory for test purposes.
 * Convenience wrapper for tests.
 */
export async function createTestTempDir(testName: string): Promise<string> {
	return createTempDir("test", testName);
}

/**
 * Parse timestamp from a timestamped directory name.
 * Expected format: YYYYMMDD-HHmmss-{purpose}
 *
 * @returns Date object or null if parsing fails
 */
export function parseTimestampFromDirName(dirName: string): Date | null {
	// Extract timestamp portion (first 15 chars: YYYYMMDD-HHmmss)
	const match = dirName.match(/^(\d{8})-(\d{6})/);
	if (!match) {
		return null;
	}

	const [, dateStr, timeStr] = match;
	const year = Number.parseInt(dateStr.slice(0, 4), 10);
	const month = Number.parseInt(dateStr.slice(4, 6), 10) - 1; // JS months are 0-indexed
	const day = Number.parseInt(dateStr.slice(6, 8), 10);
	const hour = Number.parseInt(timeStr.slice(0, 2), 10);
	const minute = Number.parseInt(timeStr.slice(2, 4), 10);
	const second = Number.parseInt(timeStr.slice(4, 6), 10);

	const date = new Date(year, month, day, hour, minute, second);

	// Validate the date is valid
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return date;
}

/**
 * Get information about all temporary directories in a category.
 *
 * @param category - Category to scan (e.g., "expanded", "test")
 * @returns Array of TempDirInfo objects, sorted by creation time (oldest first)
 */
export async function listTempDirs(category: string): Promise<TempDirInfo[]> {
	const config = getTempStorageConfig();
	const categoryPath = path.join(config.basePath, category);

	try {
		const entries = await readdir(categoryPath, { withFileTypes: true });
		const now = Date.now();
		const retentionMs = config.retentionHours * 60 * 60 * 1000;

		const infos: TempDirInfo[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}

			const createdAt = parseTimestampFromDirName(entry.name);
			if (!createdAt) {
				// Not a timestamped directory, skip
				continue;
			}

			const fullPath = path.join(categoryPath, entry.name);
			const sizeBytes = await getDirectorySize(fullPath);
			const ageMs = now - createdAt.getTime();
			const ageHours = ageMs / (60 * 60 * 1000);
			const shouldCleanup = ageMs > retentionMs;

			infos.push({
				path: fullPath,
				name: entry.name,
				createdAt,
				sizeBytes,
				ageHours,
				shouldCleanup,
			});
		}

		// Sort by creation time (oldest first)
		infos.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

		return infos;
	} catch (error) {
		// Category directory doesn't exist yet
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

/**
 * Get information about all temporary directories across all categories.
 */
export async function listAllTempDirs(): Promise<TempDirInfo[]> {
	const config = getTempStorageConfig();

	try {
		const categories = await readdir(config.basePath, { withFileTypes: true });
		const allInfos: TempDirInfo[] = [];

		for (const category of categories) {
			if (!category.isDirectory()) {
				continue;
			}

			const infos = await listTempDirs(category.name);
			allInfos.push(...infos);
		}

		// Sort by creation time (oldest first)
		allInfos.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

		return allInfos;
	} catch (error) {
		// Temp directory doesn't exist yet
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

/**
 * Clean up temporary directories that exceed the retention period.
 *
 * @param category - Category to clean (omit to clean all categories)
 * @param dryRun - If true, only report what would be deleted without actually deleting
 * @returns Array of cleaned up directory info
 */
export async function cleanupTempDirs(
	category?: string,
	dryRun = false,
): Promise<TempDirInfo[]> {
	const dirs = category
		? await listTempDirs(category)
		: await listAllTempDirs();

	const toCleanup = dirs.filter((d) => d.shouldCleanup);

	if (!dryRun) {
		for (const dir of toCleanup) {
			await rm(dir.path, { recursive: true, force: true });
		}
	}

	return toCleanup;
}

/**
 * Delete a specific temporary directory.
 * Safe to call even if directory doesn't exist.
 */
export async function deleteTempDir(dirPath: string): Promise<void> {
	await rm(dirPath, { recursive: true, force: true });
}

/**
 * Format a date as a timestamp for directory names.
 * Format: YYYYMMDD-HHmmss
 */
function formatTimestamp(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	const second = String(date.getSeconds()).padStart(2, "0");

	return `${year}${month}${day}-${hour}${minute}${second}`;
}

/**
 * Calculate the total size of a directory recursively.
 */
async function getDirectorySize(dirPath: string): Promise<number> {
	let totalSize = 0;

	try {
		const entries = await readdir(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory()) {
				totalSize += await getDirectorySize(fullPath);
			} else {
				const stats = await stat(fullPath);
				totalSize += stats.size;
			}
		}
	} catch (error) {
		// Ignore errors (e.g., permission denied, file deleted during scan)
		console.warn(`Warning: Failed to calculate size for ${dirPath}:`, error);
	}

	return totalSize;
}
