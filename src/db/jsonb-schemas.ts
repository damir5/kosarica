import { z } from "zod";

// ============================================================================
// Task Queue Payloads (discriminated union)
// ============================================================================

export const ingestionTaskPayload = z.object({
	type: z.literal("ingestion"),
	chainSlug: z.string(),
	targetDate: z.string().optional(),
	force: z.boolean().optional(),
	source: z.string().optional(),
	sourceUrl: z.string().optional(),
	archiveId: z.string().optional(),
});

export const rerunTaskPayload = z.object({
	type: z.literal("rerun"),
	originalRunId: z.string(),
	rerunType: z.enum(["file", "chunk", "entry"]),
	targetId: z.string(),
});

export const cleanupTaskPayload = z.object({
	type: z.literal("cleanup"),
	daysToKeep: z.number().int().positive().optional(),
});

export const clickhouseSyncTaskPayload = z.object({
	type: z.literal("clickhouseSync"),
	mode: z.enum(["missing", "all"]),
});

export const categorizeTaskPayload = z
	.object({
		type: z.literal("categorize"),
		runId: z.string().optional(),
		chainSlug: z.string().optional(),
		batchSize: z.number().int().min(1).max(5000).optional(),
		maxBatches: z.number().int().min(1).max(20_000).optional(),
		maxRuntimeMinutes: z.number().int().min(1).max(24 * 60).optional(),
	})
	.superRefine((payload, ctx) => {
		const hasRunId =
			typeof payload.runId === "string" && payload.runId.length > 0;
		const hasChainSlug =
			typeof payload.chainSlug === "string" && payload.chainSlug.length > 0;
		const isRunScoped = hasRunId || hasChainSlug;

		if (isRunScoped && !(hasRunId && hasChainSlug)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "categorize payload must include both runId and chainSlug",
			});
		}
	});

export const barcodeAnchorTaskPayload = z.object({
	type: z.literal("barcodeAnchor"),
	limit: z.number().int().positive().optional(),
	minChains: z.number().int().positive().optional(),
	dryRun: z.boolean().optional(),
});

export const semanticClusteringPairwiseTaskPayload = z.object({
	type: z.literal("semanticClusteringPairwise"),
	maxBatches: z.number().int().min(1).max(50).optional(),
	featureBatchSize: z.number().int().min(1).max(50_000).optional(),
	embeddingBackfillBatchSize: z.number().int().min(1).max(50_000).optional(),
	candidateSourceBatch: z.number().int().min(1).max(50_000).optional(),
	candidateInsertLimit: z.number().int().min(1).max(200_000).optional(),
	adjudicationBatchSize: z.number().int().min(1).max(10_000).optional(),
	llmPromptBatchSize: z.number().int().min(1).max(200).optional(),
	rebuildClusters: z.boolean().optional(),
});

export const semanticClusteringListwiseTaskPayload = z.object({
	type: z.literal("semanticClusteringListwise"),
	limit: z.number().int().min(1).max(500).optional(),
	minChains: z.number().int().min(1).max(20).optional(),
	dryRun: z.boolean().optional(),
	minPrimaryConfidence: z.number().min(0).max(1).optional(),
	primaryModelId: z.string().optional(),
	secondaryModelId: z.string().optional(),
});

export const semanticClusteringUnifiedTaskPayload = z.object({
	type: z.literal("semanticClusteringUnified"),
	limit: z.number().int().min(1).max(500).optional(),
	dryRun: z.boolean().optional(),
	minPrimaryConfidence: z.number().min(0).max(1).optional(),
	primaryModelId: z.string().optional(),
	secondaryModelId: z.string().optional(),
	maxGroupSize: z.number().int().min(2).max(200).optional(),
	groupsPerCall: z.number().int().min(1).max(20).optional(),
	barcodeLimit: z.number().int().min(1).max(1000).optional(),
	barcodeMinChains: z.number().int().min(1).max(20).optional(),
	deterministicLimit: z.number().int().min(1).max(1000).optional(),
	embeddingLimit: z.number().int().min(1).max(500).optional(),
	lexicalLimit: z.number().int().min(1).max(500).optional(),
});

export const matchingTaskPayload = z.discriminatedUnion("type", [
	semanticClusteringPairwiseTaskPayload,
	semanticClusteringListwiseTaskPayload,
	semanticClusteringUnifiedTaskPayload,
]);

export const taskQueuePayload = z.discriminatedUnion("type", [
	ingestionTaskPayload,
	rerunTaskPayload,
	cleanupTaskPayload,
	clickhouseSyncTaskPayload,
	categorizeTaskPayload,
	barcodeAnchorTaskPayload,
	semanticClusteringPairwiseTaskPayload,
	semanticClusteringListwiseTaskPayload,
	semanticClusteringUnifiedTaskPayload,
]);

// ============================================================================
// Validation Errors
// ============================================================================

export const validationError = z.object({
	field: z.string().optional(),
	message: z.string(),
	code: z.string().optional(),
	value: z.unknown().optional(),
});

export const validationErrors = z.array(validationError);

// ============================================================================
// Cron Job Payload (loose object allows additional properties)
// ============================================================================

export const cronJobPayload = z.looseObject({
	chainSlug: z.string().optional(),
	taskType: z.string().optional(),
});

// ============================================================================
// Cron Run Metadata (loose object allows additional properties)
// ============================================================================

export const cronRunMetadata = z.looseObject({
	startedAt: z.string().optional(),
	completedAt: z.string().optional(),
	error: z.string().optional(),
});

// ============================================================================
// Archive Metadata (loose object allows additional properties)
// ============================================================================

export const archiveMetadata = z.looseObject({
	originalFilename: z.string().optional(),
	encoding: z.string().optional(),
	extractedFiles: z.array(z.string()).optional(),
	contentType: z.string().optional(),
	fileType: z.string().optional(), // csv, xml, json, xlsx, zip
});

// ============================================================================
// Catalog Event Payload + LLM Observability Payloads
// ============================================================================

export const catalogEventPayload = z.looseObject({
	before: z.unknown().optional(),
	after: z.unknown().optional(),
	reason: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const llmDecisionInput = z.looseObject({
	prompt: z.string().optional(),
	items: z.array(z.unknown()).optional(),
	context: z.unknown().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const llmDecisionOutput = z.looseObject({
	verdict: z.string().optional(),
	confidence: z.number().optional(),
	reasoning: z.string().optional(),
	result: z.unknown().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Export Types
// ============================================================================

export type IngestionTaskPayload = z.infer<typeof ingestionTaskPayload>;
export type RerunTaskPayload = z.infer<typeof rerunTaskPayload>;
export type CleanupTaskPayload = z.infer<typeof cleanupTaskPayload>;
export type ClickHouseSyncTaskPayload = z.infer<
	typeof clickhouseSyncTaskPayload
>;
export type CategorizeTaskPayload = z.infer<typeof categorizeTaskPayload>;
export type BarcodeAnchorTaskPayload = z.infer<typeof barcodeAnchorTaskPayload>;
export type SemanticClusteringPairwiseTaskPayload = z.infer<
	typeof semanticClusteringPairwiseTaskPayload
>;
export type SemanticClusteringListwiseTaskPayload = z.infer<
	typeof semanticClusteringListwiseTaskPayload
>;
export type SemanticClusteringUnifiedTaskPayload = z.infer<
	typeof semanticClusteringUnifiedTaskPayload
>;
export type MatchingTaskPayload = z.infer<typeof matchingTaskPayload>;
export type TaskQueuePayload = z.infer<typeof taskQueuePayload>;
export type ValidationError = z.infer<typeof validationError>;
export type ValidationErrors = z.infer<typeof validationErrors>;
export type CronJobPayload = z.infer<typeof cronJobPayload>;
export type CronRunMetadata = z.infer<typeof cronRunMetadata>;
export type ArchiveMetadata = z.infer<typeof archiveMetadata>;
export type CatalogEventPayload = z.infer<typeof catalogEventPayload>;
export type LlmDecisionInput = z.infer<typeof llmDecisionInput>;
export type LlmDecisionOutput = z.infer<typeof llmDecisionOutput>;
