import { and, eq, isNull } from "drizzle-orm";
import { retailerItemFeatures, retailerItems, skuItemLinks } from "@/db/schema";
import { generateCandidates } from "@/lib/feature-matching";
import { logLlmDecision } from "@/lib/llm-observability";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import type { CronExecutionContext, CronJobHandler } from "../types";

const log = createLogger("scheduler");

export const featureMatchBatchHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		const db = getDb();
		const candidateLimit = Number.parseInt(
			process.env.FEATURE_MATCH_BATCH_LIMIT ?? "100",
			10,
		);
		const rows = await db
			.select({
				retailerItemId: retailerItems.id,
			})
			.from(retailerItems)
			.innerJoin(
				retailerItemFeatures,
				eq(retailerItemFeatures.retailerItemId, retailerItems.id),
			)
			.leftJoin(
				skuItemLinks,
				eq(skuItemLinks.retailerItemId, retailerItems.id),
			)
			.where(
				and(
					isNull(retailerItems.mergedIntoId),
					isNull(skuItemLinks.retailerItemId),
				),
			)
			.limit(Number.isFinite(candidateLimit) && candidateLimit > 0 ? candidateLimit : 100);

		let processed = 0;
		let nonEmpty = 0;
		for (const row of rows) {
			const candidates = await generateCandidates({
				sourceItemId: row.retailerItemId,
				limit: 10,
				minScore: 0.5,
				excludeLinked: true,
			});
			processed += 1;
			if (candidates.length > 0) {
				nonEmpty += 1;
			}
			await logLlmDecision({
				taskType: "feature_match",
				input: {
					retailerItemId: row.retailerItemId,
				},
				output: {
					candidateCount: candidates.length,
					topCandidates: candidates.slice(0, 5),
				},
				modelId: "heuristic",
				provider: "rule-engine",
				verdict: candidates.length > 0 ? "CANDIDATES_FOUND" : "NO_CANDIDATES",
				confidence: candidates[0]?.score ?? 0,
				reasoning: "Deterministic feature-match candidate generation",
			});
		}

		log.info("Feature match batch completed", {
			runId: context.runId,
			processed,
			nonEmpty,
		});

		return [];
	},
};
