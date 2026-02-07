/**
 * Manual semantic clustering loop.
 *
 * Usage: DATABASE_URL=... pnpm matching:clusters
 */

import { runSemanticClusteringPipeline } from "@/lib/semantic-clustering";
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

async function main() {
	const maxRounds = parsePositiveIntEnv("SEMANTIC_CLUSTERING_MAX_BATCHES", 20);
	const featureBatchSize = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_FEATURE_BATCH_SIZE",
		2000,
	);
	const candidateSourceBatch = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_CANDIDATE_SOURCE_BATCH",
		1000,
	);
	const candidateInsertLimit = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_CANDIDATE_INSERT_LIMIT",
		5000,
	);
	const adjudicationBatchSize = parsePositiveIntEnv(
		"SEMANTIC_CLUSTERING_ADJUDICATION_BATCH_SIZE",
		200,
	);

	let rounds = 0;
	let totalFeatures = 0;
	let totalCandidates = 0;
	let totalAdjudicated = 0;
	let totalApproved = 0;
	let totalRejected = 0;
	let totalReview = 0;
	let totalErrors = 0;

	console.log("\n=== Manual Semantic Clustering ===");
	for (let i = 0; i < maxRounds; i += 1) {
		rounds += 1;
		const result = await runSemanticClusteringPipeline({
			featureBatchSize,
			candidateSourceBatch,
			candidateInsertLimit,
			adjudicationBatchSize,
			rebuildClusters: true,
		});

		totalFeatures += result.featuresUpserted;
		totalCandidates += result.candidatesQueued;
		totalAdjudicated += result.pairsAdjudicated;
		totalApproved += result.autoApproved;
		totalRejected += result.autoRejected;
		totalReview += result.pendingReview;
		totalErrors += result.systemErrors;

		console.log(
			`Round ${rounds}: features=${result.featuresUpserted}, candidates=${result.candidatesQueued}, adjudicated=${result.pairsAdjudicated}, approved=${result.autoApproved}, rejected=${result.autoRejected}, review=${result.pendingReview}, errors=${result.systemErrors}`,
		);

		if (
			result.featuresUpserted === 0 &&
			result.candidatesQueued === 0 &&
			result.pairsAdjudicated === 0
		) {
			console.log("No new work detected, stopping.");
			break;
		}
	}

	console.log(`\nRounds: ${rounds}`);
	console.log(`Features upserted: ${totalFeatures}`);
	console.log(`Candidates queued: ${totalCandidates}`);
	console.log(`Pairs adjudicated: ${totalAdjudicated}`);
	console.log(`Auto-approved: ${totalApproved}`);
	console.log(`Auto-rejected: ${totalRejected}`);
	console.log(`Pending review: ${totalReview}`);
	console.log(`System errors: ${totalErrors}`);
}

main().catch((error) => {
	log.error("Manual semantic clustering failed", { error });
	console.error(error);
	process.exit(1);
});
