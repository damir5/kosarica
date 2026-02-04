import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { getTempStorageConfig, listAllTempDirs } from "@/lib/storage";

/**
 * Storage Health Check Script
 *
 * Reports on the health and status of the storage system:
 * - Archive sizes and file counts
 * - Parquet sizes and file counts
 * - Temporary storage status
 * - Compression ratios
 * - Orphaned files
 */

interface DirectoryStats {
	path: string;
	sizeBytes: number;
	fileCount: number;
	subdirs: string[];
}

async function getDirectoryStats(dirPath: string): Promise<DirectoryStats> {
	let sizeBytes = 0;
	let fileCount = 0;
	const subdirs: string[] = [];

	try {
		const entries = await readdir(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dirPath, entry.name);

			if (entry.isDirectory()) {
				subdirs.push(entry.name);
				const subStats = await getDirectoryStats(fullPath);
				sizeBytes += subStats.sizeBytes;
				fileCount += subStats.fileCount;
			} else {
				const stats = await stat(fullPath);
				sizeBytes += stats.size;
				fileCount++;
			}
		}
	} catch (error) {
		// Directory doesn't exist or can't be read
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			console.warn(`Warning: Could not read ${dirPath}:`, error);
		}
	}

	return { path: dirPath, sizeBytes, fileCount, subdirs };
}

function formatSize(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function formatNumber(num: number): string {
	return num.toLocaleString();
}

async function main() {
	console.log("🏥 Storage Health Check");
	console.log("======================\n");

	const storagePath = process.env.STORAGE_PATH || "./data/storage";
	const tempConfig = getTempStorageConfig();

	// Check archives
	console.log("📦 Archives (Original Downloads)");
	console.log("-".repeat(50));
	const archivesStats = await getDirectoryStats(join(storagePath, "archives"));
	console.log(`  Location: ${archivesStats.path}`);
	console.log(`  Total Size: ${formatSize(archivesStats.sizeBytes)}`);
	console.log(`  File Count: ${formatNumber(archivesStats.fileCount)}`);
	console.log(`  Chains: ${archivesStats.subdirs.length} (${archivesStats.subdirs.join(", ")})`);
	console.log();

	// Check parquet
	console.log("📊 Parquet (Processed Cache)");
	console.log("-".repeat(50));
	const parquetStats = await getDirectoryStats(join(storagePath, "parquet"));
	console.log(`  Location: ${parquetStats.path}`);
	console.log(`  Total Size: ${formatSize(parquetStats.sizeBytes)}`);
	console.log(`  File Count: ${formatNumber(parquetStats.fileCount)}`);
	console.log(`  Chains: ${parquetStats.subdirs.length} (${parquetStats.subdirs.join(", ")})`);
	console.log();

	// Check temp storage
	console.log("🗂️  Temporary Storage");
	console.log("-".repeat(50));
	const tempDirs = await listAllTempDirs();
	const tempStats = await getDirectoryStats(tempConfig.basePath);
	console.log(`  Location: ${tempConfig.basePath}`);
	console.log(`  Total Size: ${formatSize(tempStats.sizeBytes)}`);
	console.log(`  Directory Count: ${tempDirs.length}`);
	console.log(`  Retention: ${tempConfig.retentionHours} hours`);

	if (tempDirs.length > 0) {
		const oldDirs = tempDirs.filter((d) => d.shouldCleanup);
		console.log(`  Ready for cleanup: ${oldDirs.length} directories`);
		
		if (oldDirs.length > 0) {
			const oldSize = oldDirs.reduce((sum, d) => sum + d.sizeBytes, 0);
			console.log(`    (Would free ${formatSize(oldSize)})`);
		}
	}
	console.log();

	// Overall summary
	console.log("📈 Overall Statistics");
	console.log("-".repeat(50));
	const totalPermanent = archivesStats.sizeBytes + parquetStats.sizeBytes;
	const totalWithTemp = totalPermanent + tempStats.sizeBytes;
	console.log(`  Permanent Storage: ${formatSize(totalPermanent)}`);
	console.log(`    - Archives: ${formatSize(archivesStats.sizeBytes)} (${((archivesStats.sizeBytes / totalPermanent) * 100).toFixed(1)}%)`);
	console.log(`    - Parquet: ${formatSize(parquetStats.sizeBytes)} (${((parquetStats.sizeBytes / totalPermanent) * 100).toFixed(1)}%)`);
	console.log(`  Temporary Storage: ${formatSize(tempStats.sizeBytes)}`);
	console.log(`  Total Storage: ${formatSize(totalWithTemp)}`);
	console.log(`  Total Files: ${formatNumber(archivesStats.fileCount + parquetStats.fileCount + tempStats.fileCount)}`);
	console.log();

	// Compression analysis
	console.log("🗜️  Compression Analysis");
	console.log("-".repeat(50));
	
	// Count compressed vs uncompressed in archives
	let compressedCount = 0;
	let uncompressedCount = 0;
	
	async function countCompressed(dirPath: string): Promise<void> {
		try {
			const entries = await readdir(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(dirPath, entry.name);
				if (entry.isDirectory()) {
					await countCompressed(fullPath);
				} else {
					if (entry.name.endsWith(".gz") || entry.name.endsWith(".zip")) {
						compressedCount++;
					} else if (!entry.name.endsWith(".json")) {
						// Skip metadata files
						uncompressedCount++;
					}
				}
			}
		} catch (error) {
			// Ignore errors
		}
	}
	
	await countCompressed(join(storagePath, "archives"));
	
	console.log(`  Compressed files: ${formatNumber(compressedCount)}`);
	console.log(`  Uncompressed files: ${formatNumber(uncompressedCount)}`);
	if (compressedCount + uncompressedCount > 0) {
		const compressionRate = (compressedCount / (compressedCount + uncompressedCount)) * 100;
		console.log(`  Compression rate: ${compressionRate.toFixed(1)}%`);
	}
	console.log();

	// Recommendations
	console.log("💡 Recommendations");
	console.log("-".repeat(50));
	
	const recommendations: string[] = [];
	
	if (tempDirs.filter((d) => d.shouldCleanup).length > 0) {
		recommendations.push("Run cleanup script to remove old temporary files");
		recommendations.push("  → pnpm tsx scripts/cleanup-temp-storage.ts");
	}
	
	if (tempStats.sizeBytes > archivesStats.sizeBytes * 0.1) {
		recommendations.push("Temporary storage is >10% of archives - consider reducing retention period");
	}
	
	if (recommendations.length === 0) {
		console.log("  ✅ Storage is healthy - no actions needed");
	} else {
		for (const rec of recommendations) {
			console.log(`  • ${rec}`);
		}
	}
	console.log();
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
