import { z } from "zod";
import { scheduleTask } from "@/lib/taskqueue";
import { superadminProcedure } from "../base";

export const triggerUnifiedMatching = superadminProcedure
	.input(
		z
			.object({
				limit: z.number().int().min(1).max(500).optional(),
				dryRun: z.boolean().optional(),
				minPrimaryConfidence: z.number().min(0).max(1).optional(),
				maxGroupSize: z.number().int().min(2).max(200).optional(),
				groupsPerCall: z.number().int().min(1).max(20).optional(),
				blocking: z
					.object({
						barcodeLimit: z.number().int().min(1).max(1000).optional(),
						barcodeMinChains: z.number().int().min(1).max(20).optional(),
						deterministicLimit: z.number().int().min(1).max(1000).optional(),
						embeddingLimit: z.number().int().min(1).max(500).optional(),
						lexicalLimit: z.number().int().min(1).max(500).optional(),
					})
					.optional(),
			})
			.optional(),
	)
	.handler(async ({ input }) => {
		const task = await scheduleTask({
			taskType: "matching",
			priority: -1,
			payload: {
				type: "semanticClusteringUnified",
				limit: input?.limit,
				dryRun: input?.dryRun,
				minPrimaryConfidence: input?.minPrimaryConfidence,
				maxGroupSize: input?.maxGroupSize,
				groupsPerCall: input?.groupsPerCall,
				barcodeLimit: input?.blocking?.barcodeLimit,
				barcodeMinChains: input?.blocking?.barcodeMinChains,
				deterministicLimit: input?.blocking?.deterministicLimit,
				embeddingLimit: input?.blocking?.embeddingLimit,
				lexicalLimit: input?.blocking?.lexicalLimit,
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
			})
			.optional(),
	)
	.handler(async ({ input }) => {
		const task = await scheduleTask({
			taskType: "matching",
			priority: -1,
			payload: {
				type: "semanticClusteringListwise",
				limit: input?.limit,
				minChains: input?.minChains,
				dryRun: input?.dryRun,
				minPrimaryConfidence: input?.minPrimaryConfidence,
			},
		});

		return { queued: true, taskId: task.id };
	});
