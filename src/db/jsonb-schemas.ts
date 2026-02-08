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

export const categorizeTaskPayload = z.object({
	type: z.literal("categorize"),
	runId: z.string(),
	chainSlug: z.string(),
});

export const barcodeAnchorTaskPayload = z.object({
	type: z.literal("barcodeAnchor"),
	limit: z.number().int().positive().optional(),
	minChains: z.number().int().positive().optional(),
	dryRun: z.boolean().optional(),
});

export const taskQueuePayload = z.discriminatedUnion("type", [
	ingestionTaskPayload,
	rerunTaskPayload,
	cleanupTaskPayload,
	clickhouseSyncTaskPayload,
	categorizeTaskPayload,
	barcodeAnchorTaskPayload,
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
export type TaskQueuePayload = z.infer<typeof taskQueuePayload>;
export type ValidationError = z.infer<typeof validationError>;
export type ValidationErrors = z.infer<typeof validationErrors>;
export type CronJobPayload = z.infer<typeof cronJobPayload>;
export type CronRunMetadata = z.infer<typeof cronRunMetadata>;
export type ArchiveMetadata = z.infer<typeof archiveMetadata>;
export type CatalogEventPayload = z.infer<typeof catalogEventPayload>;
export type LlmDecisionInput = z.infer<typeof llmDecisionInput>;
export type LlmDecisionOutput = z.infer<typeof llmDecisionOutput>;
