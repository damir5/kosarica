import { config } from "dotenv";
config({ path: ".env.development" });
config();

import {
	cleanupTempDirs,
	getTempStorageConfig,
	listAllTempDirs,
} from "@/lib/storage/temp";

/**
 * Manual cleanup script for temporary storage.
 * Removes temp directories older than TEMP_FILE_RETENTION_HOURS.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-temp-storage.ts          # Execute cleanup
 *   pnpm tsx scripts/cleanup-temp-storage.ts --dry-run # Preview without deleting
 */

async function main() {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");

	console.log("🧹 Temporary Storage Cleanup");
	console.log("=============================\n");

	const config = getTempStorageConfig();
	console.log("Configuration:");
	console.log(`  Base Path: ${config.basePath}`);
	console.log(`  Retention: ${config.retentionHours} hours\n`);

	if (dryRun) {
		console.log("🔍 DRY RUN MODE - No files will be deleted\n");
	}

	// List all temp directories
	const allDirs = await listAllTempDirs();

	if (allDirs.length === 0) {
		console.log("✨ No temporary directories found.");
		return;
	}

	console.log(`Found ${allDirs.length} temporary directory(ies):\n`);

	// Group by should cleanup
	const toCleanup = allDirs.filter((d) => d.shouldCleanup);
	const toKeep = allDirs.filter((d) => !d.shouldCleanup);

	// Display directories to keep
	if (toKeep.length > 0) {
		console.log(`📁 Keeping ${toKeep.length} recent directory(ies):`);
		for (const dir of toKeep) {
			console.log(
				`  ✓ ${dir.name} (${formatSize(dir.sizeBytes)}, ${dir.ageHours.toFixed(1)}h old)`,
			);
		}
		console.log();
	}

	// Display and clean up old directories
	if (toCleanup.length > 0) {
		console.log(`🗑️  ${dryRun ? "Would delete" : "Deleting"} ${toCleanup.length} old directory(ies):`);

		let totalSize = 0;
		for (const dir of toCleanup) {
			totalSize += dir.sizeBytes;
			console.log(
				`  ${dryRun ? "→" : "✗"} ${dir.name} (${formatSize(dir.sizeBytes)}, ${dir.ageHours.toFixed(1)}h old)`,
			);
		}

		console.log();

		if (!dryRun) {
			// Execute cleanup
			const cleaned = await cleanupTempDirs(undefined, false);
			console.log(
				`✅ Cleaned up ${cleaned.length} directory(ies), freed ${formatSize(totalSize)}`,
			);
		} else {
			console.log(
				`💡 Would free ${formatSize(totalSize)} (run without --dry-run to execute)`,
			);
		}
	} else {
		console.log("✨ No directories need cleanup.");
	}
}

/**
 * Format bytes as human-readable size.
 */
function formatSize(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(1)} ${units[unitIndex]}`;
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
