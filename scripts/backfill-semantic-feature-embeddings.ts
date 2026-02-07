import { sql } from "drizzle-orm";
import { backfillMissingFeatureEmbeddings } from "@/lib/semantic-clustering";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

function parsePositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function countMissingEmbeddings(): Promise<number> {
	const db = getDb();
	const result = await db.execute(sql`
		SELECT count(*)::int AS missing_count
		FROM retailer_item_features rif
		JOIN retailer_items ri ON ri.id = rif.retailer_item_id
		WHERE ri.merged_into_id IS NULL
			AND rif.embedding IS NULL
	`);
	const row = Array.isArray(result)
		? (result[0] as { missing_count?: number } | undefined)
		: ((result as { rows?: Array<{ missing_count?: number }> }).rows?.[0] ??
			undefined);
	const count = Number(row?.missing_count ?? 0);
	return Number.isFinite(count) ? count : 0;
}

async function main() {
	const batchSize = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_EMBEDDING_BACKFILL_BATCH_SIZE",
		500,
	);
	const maxBatches = parsePositiveIntEnv("SEMANTIC_CLUSTERING_MAX_BATCHES", 1000);

	let totalUpdated = 0;
	let batchesProcessed = 0;
	const startedAt = Date.now();

	console.log("\n=== Semantic Feature Embedding Backfill ===");
	for (let i = 0; i < maxBatches; i += 1) {
		const updated = await backfillMissingFeatureEmbeddings(batchSize);
		if (updated === 0) {
			break;
		}

		batchesProcessed += 1;
		totalUpdated += updated;
		const elapsedMs = Date.now() - startedAt;
		const ratePerSecond = elapsedMs > 0 ? totalUpdated / (elapsedMs / 1000) : 0;

		console.log(
			`Batch ${batchesProcessed}: updated=${updated}, totalUpdated=${totalUpdated}, rate=${ratePerSecond.toFixed(2)} rows/s`,
		);
	}

	const missingAfter = await countMissingEmbeddings();
	const elapsedSeconds = (Date.now() - startedAt) / 1000;
	console.log("\nBackfill summary:");
	console.log(`Batches processed: ${batchesProcessed}`);
	console.log(`Rows updated: ${totalUpdated}`);
	console.log(`Missing embeddings remaining: ${missingAfter}`);
	console.log(`Elapsed seconds: ${elapsedSeconds.toFixed(1)}`);
}

main().catch((error) => {
	log.error("Semantic feature embedding backfill failed", { error });
	console.error(error);
	process.exit(1);
});
