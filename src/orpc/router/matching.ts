import { z } from "zod";
import { scheduleTask } from "@/lib/taskqueue";
import { superadminProcedure } from "../base";

export const triggerPairwiseSemanticClustering = superadminProcedure
	.input(
		z
			.object({
				maxBatches: z.number().int().min(1).max(50).optional(),
				featureBatchSize: z.number().int().min(1).max(50_000).optional(),
				embeddingBackfillBatchSize: z
					.number()
					.int()
					.min(1)
					.max(50_000)
					.optional(),
				candidateSourceBatch: z.number().int().min(1).max(50_000).optional(),
				candidateInsertLimit: z.number().int().min(1).max(200_000).optional(),
				adjudicationBatchSize: z.number().int().min(1).max(10_000).optional(),
				llmPromptBatchSize: z.number().int().min(1).max(200).optional(),
				rebuildClusters: z.boolean().optional(),
			})
			.optional(),
	)
	.handler(async ({ input }) => {
		const task = await scheduleTask({
			taskType: "matching",
			payload: {
				type: "semanticClusteringPairwise",
				maxBatches: input?.maxBatches,
				featureBatchSize: input?.featureBatchSize,
				embeddingBackfillBatchSize: input?.embeddingBackfillBatchSize,
				candidateSourceBatch: input?.candidateSourceBatch,
				candidateInsertLimit: input?.candidateInsertLimit,
				adjudicationBatchSize: input?.adjudicationBatchSize,
				llmPromptBatchSize: input?.llmPromptBatchSize,
				rebuildClusters: input?.rebuildClusters,
			},
		});

		return { queued: true, taskId: task.id };
	});

export const triggerListwiseSemanticClustering = superadminProcedure
	.input(
		z
			.object({
				limit: z.number().int().min(1).max(500).optional(),
				minChains: z.number().int().min(1).max(20).optional(),
				dryRun: z.boolean().optional(),
				minPrimaryConfidence: z.number().min(0).max(1).optional(),
				primaryModelId: z.string().optional(),
				secondaryModelId: z.string().optional(),
			})
			.optional(),
	)
	.handler(async ({ input }) => {
		const task = await scheduleTask({
			taskType: "matching",
			payload: {
				type: "semanticClusteringListwise",
				limit: input?.limit,
				minChains: input?.minChains,
				dryRun: input?.dryRun,
				minPrimaryConfidence: input?.minPrimaryConfidence,
				primaryModelId: input?.primaryModelId,
				secondaryModelId: input?.secondaryModelId,
			},
		});

		return { queued: true, taskId: task.id };
	});
