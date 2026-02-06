/**
 * Manual Matching Script
 *
 * Runs barcode matching in a loop until no progress,
 * then runs trigram matching in a loop until no progress.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/run-matching-manual.ts
 */

import { runBarcodeMatching, runTrigramMatching } from "@/lib/matching";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

async function main() {
	const startTime = Date.now();

	// Phase 1: Barcode matching
	console.log("\n=== Barcode Matching ===");
	let barcodeRounds = 0;
	let totalNewProducts = 0;
	let totalNewLinks = 0;
	let totalSuspiciousFlags = 0;
	let totalSkipped = 0;

	while (true) {
		barcodeRounds++;
		const result = await runBarcodeMatching({ batchSize: 1000 });

		totalNewProducts += result.newProducts;
		totalNewLinks += result.newLinks;
		totalSuspiciousFlags += result.suspiciousFlags;
		totalSkipped += result.skipped;

		const progress =
			result.newProducts + result.newLinks + result.suspiciousFlags;
		console.log(
			`  Round ${barcodeRounds}: +${result.newProducts} products, +${result.newLinks} links, ${result.suspiciousFlags} suspicious, ${result.skipped} skipped`,
		);

		if (progress === 0) {
			console.log("  No more progress, stopping barcode matching.");
			break;
		}
	}

	console.log(`\nBarcode totals: ${totalNewProducts} products, ${totalNewLinks} links, ${totalSuspiciousFlags} suspicious, ${totalSkipped} skipped`);

	// Phase 2: Trigram matching
	console.log("\n=== Trigram Matching ===");
	let trigramRounds = 0;
	let totalProcessed = 0;
	let totalHighConfidence = 0;
	let totalQueuedForReview = 0;
	let totalNoMatch = 0;

	while (true) {
		trigramRounds++;
		const result = await runTrigramMatching({ batchSize: 200 });

		totalProcessed += result.processed;
		totalHighConfidence += result.highConfidence;
		totalQueuedForReview += result.queuedForReview;
		totalNoMatch += result.noMatch;

		const progress = result.processed + result.noMatch;
		console.log(
			`  Round ${trigramRounds}: processed=${result.processed}, high=${result.highConfidence}, review=${result.queuedForReview}, noMatch=${result.noMatch}`,
		);

		if (progress === 0) {
			console.log("  No more progress, stopping trigram matching.");
			break;
		}

		// Safety limit
		if (trigramRounds >= 100) {
			console.log("  Reached max rounds limit (100), stopping.");
			break;
		}
	}

	const duration = Date.now() - startTime;
	console.log(
		`\nTrigram totals: ${totalProcessed} processed, ${totalHighConfidence} high-confidence, ${totalQueuedForReview} queued, ${totalNoMatch} no-match`,
	);
	console.log(`\nTotal duration: ${Math.round(duration / 1000)}s`);
}

main().catch((error) => {
	log.error("Manual matching failed", { error });
	console.error(error);
	process.exit(1);
});
