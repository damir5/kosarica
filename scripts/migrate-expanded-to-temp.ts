import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { rm } from "node:fs/promises";
import { createLogger } from "@/utils/logger";

/**
 * Migration script to clean up old expanded/ directory.
 * 
 * The expanded files are no longer needed since:
 * 1. They can be regenerated from archives/ on demand
 * 2. New ingestion runs use temporary storage (data/temp/)
 * 
 * This script removes the old expanded/ directory to free up disk space.
 */

const log = createLogger("app");

async function main() {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");

	console.log("🗂️  Expanded Files Migration");
	console.log("============================\n");

	const expandedPath = "./data/storage/expanded";

	if (dryRun) {
		console.log("🔍 DRY RUN MODE - No files will be deleted\n");
	}

	console.log("Analysis:");
	console.log(`  Path: ${expandedPath}`);
	console.log("  Status: These files are no longer needed");
	console.log("  Reason: Can be regenerated from archives/ on demand\n");

	console.log("Action:");
	if (dryRun) {
		console.log("  Would delete the entire expanded/ directory");
		console.log("\n💡 Run without --dry-run to execute");
	} else {
		try {
			console.log("  Deleting expanded/ directory...");
			await rm(expandedPath, { recursive: true, force: true });
			console.log("  ✅ Successfully deleted expanded/ directory\n");
			
			log.info("Migrated expanded files", {
				action: "deleted",
				path: expandedPath,
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				console.log("  ℹ️  Directory doesn't exist (already cleaned up)\n");
			} else {
				console.error("  ❌ Failed to delete directory:", error);
				process.exit(1);
			}
		}
	}

	console.log("Next steps:");
	console.log("  - Future ingestion runs will use temp storage (data/temp/)");
	console.log("  - Temp files are automatically cleaned up after 48 hours");
	console.log("  - Archives remain in data/storage/archives/ for regeneration\n");
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
