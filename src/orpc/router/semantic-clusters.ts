import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	productClusters,
	semanticPairDecisions,
} from "@/db/schema";
import { runSemanticClusteringPipeline } from "@/lib/semantic-clustering";
import { getDb } from "@/utils/bindings";
import { superadminProcedure } from "../base";

const decisionKeySchema = z.object({
	itemAId: z.string(),
	itemBId: z.string(),
});

export const getPendingDecisions = superadminProcedure
	.input(
		z.object({
			limit: z.number().int().min(1).max(200).default(50),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const result = await db.execute(sql`
			SELECT
				d.item_a_id,
				d.item_b_id,
				d.method,
				d.similarity_score,
				d.llm_verdict,
				d.llm_confidence,
				d.llm_reasoning,
				d.votes_json,
				d.consensus_score,
				d.final_status,
				d.system_error,
				ria.name as item_a_name,
				rib.name as item_b_name,
				ria.chain_slug as item_a_chain,
				rib.chain_slug as item_b_chain
			FROM semantic_pair_decisions d
			JOIN retailer_items ria ON ria.id = d.item_a_id
			JOIN retailer_items rib ON rib.id = d.item_b_id
			WHERE d.final_status IN ('PENDING_REVIEW', 'SYSTEM_ERROR')
			ORDER BY d.updated_at DESC
			LIMIT ${input.limit}
		`);

		const items = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
			item_a_id: string;
			item_b_id: string;
			method: string;
			similarity_score: number | null;
			llm_verdict: string | null;
			llm_confidence: number | null;
			llm_reasoning: string | null;
			votes_json: string | null;
			consensus_score: number | null;
			final_status: string;
			system_error: string | null;
			item_a_name: string;
			item_b_name: string;
			item_a_chain: string | null;
			item_b_chain: string | null;
		}>;

		return {
			items: items.map((row) => ({
				itemAId: row.item_a_id,
				itemBId: row.item_b_id,
				method: row.method,
				similarityScore: row.similarity_score,
				llmVerdict: row.llm_verdict,
				llmConfidence: row.llm_confidence,
				llmReasoning: row.llm_reasoning,
				votesJson: row.votes_json,
				consensusScore: row.consensus_score,
				finalStatus: row.final_status,
				systemError: row.system_error,
				itemA: {
					name: row.item_a_name,
					chainSlug: row.item_a_chain,
				},
				itemB: {
					name: row.item_b_name,
					chainSlug: row.item_b_chain,
				},
			})),
		};
	});

export const approveDecision = superadminProcedure
	.input(
		decisionKeySchema.extend({
			verdict: z.enum([
				"EXACT_MATCH",
				"SAME_BASE_DIFFERENT_VARIANT",
				"MISMATCH",
				"UNCERTAIN",
			]),
			notes: z.string().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		const db = getDb();
		const userId = (context as { user?: { id?: string } }).user?.id;

		await db
			.update(semanticPairDecisions)
			.set({
				humanVerdict: input.verdict,
				finalVerdict: input.verdict,
				finalStatus: input.verdict === "MISMATCH" ? "REJECTED" : "APPROVED",
				reviewedBy: userId ?? null,
				reviewedAt: new Date(),
				llmReasoning: input.notes ?? null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(semanticPairDecisions.itemAId, input.itemAId),
					eq(semanticPairDecisions.itemBId, input.itemBId),
				),
			);

		return { success: true };
	});

export const rejectDecision = superadminProcedure
	.input(decisionKeySchema.extend({ notes: z.string().optional() }))
	.handler(async ({ input, context }) => {
		const db = getDb();
		const userId = (context as { user?: { id?: string } }).user?.id;

		await db
			.update(semanticPairDecisions)
			.set({
				finalStatus: "REJECTED",
				humanVerdict: "MISMATCH",
				finalVerdict: "MISMATCH",
				reviewedBy: userId ?? null,
				reviewedAt: new Date(),
				llmReasoning: input.notes ?? null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(semanticPairDecisions.itemAId, input.itemAId),
					eq(semanticPairDecisions.itemBId, input.itemBId),
				),
			);

		return { success: true };
	});

export const triggerPipeline = superadminProcedure
	.input(
		z
			.object({
				featureBatchSize: z.number().int().min(1).max(100_000).optional(),
				embeddingBackfillBatchSize: z
					.number()
					.int()
					.min(1)
					.max(100_000)
					.optional(),
				candidateSourceBatch: z.number().int().min(1).max(100_000).optional(),
				candidateInsertLimit: z.number().int().min(1).max(200_000).optional(),
				adjudicationBatchSize: z.number().int().min(1).max(10_000).optional(),
				llmPromptBatchSize: z.number().int().min(1).max(200).optional(),
				semanticNeighborCount: z.number().int().min(1).max(1000).optional(),
				lexicalNeighborCount: z.number().int().min(1).max(1000).optional(),
				rebuildClusters: z.boolean().optional(),
			})
			.optional(),
	)
	.handler(async ({ input }) => {
		return await runSemanticClusteringPipeline({
			featureBatchSize: input?.featureBatchSize,
			embeddingBackfillBatchSize: input?.embeddingBackfillBatchSize,
			candidateSourceBatch: input?.candidateSourceBatch,
			candidateInsertLimit: input?.candidateInsertLimit,
			adjudicationBatchSize: input?.adjudicationBatchSize,
			llmPromptBatchSize: input?.llmPromptBatchSize,
			semanticNeighborCount: input?.semanticNeighborCount,
			lexicalNeighborCount: input?.lexicalNeighborCount,
			rebuildClusters: input?.rebuildClusters,
		});
	});

export const getClusterStats = superadminProcedure.handler(async () => {
	const db = getDb();
	const [decisionStats] = await db
		.select({
			approved: sql<number>`count(*) FILTER (WHERE ${semanticPairDecisions.finalStatus} = 'APPROVED')`,
			rejected: sql<number>`count(*) FILTER (WHERE ${semanticPairDecisions.finalStatus} = 'REJECTED')`,
			pending: sql<number>`count(*) FILTER (WHERE ${semanticPairDecisions.finalStatus} = 'PENDING_REVIEW')`,
			systemError: sql<number>`count(*) FILTER (WHERE ${semanticPairDecisions.finalStatus} = 'SYSTEM_ERROR')`,
		})
		.from(semanticPairDecisions);

	const [clusterStats] = await db
		.select({
			variant: sql<number>`count(*) FILTER (WHERE ${productClusters.clusterType} = 'variant')`,
			base: sql<number>`count(*) FILTER (WHERE ${productClusters.clusterType} = 'base')`,
		})
		.from(productClusters);

	return {
		decisions: decisionStats,
		clusters: clusterStats,
	};
});
