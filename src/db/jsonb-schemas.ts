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

export const taskQueuePayload = z.discriminatedUnion("type", [
	ingestionTaskPayload,
	rerunTaskPayload,
	cleanupTaskPayload,
	clickhouseSyncTaskPayload,
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
// Export Types
// ============================================================================

export type IngestionTaskPayload = z.infer<typeof ingestionTaskPayload>;
export type RerunTaskPayload = z.infer<typeof rerunTaskPayload>;
export type CleanupTaskPayload = z.infer<typeof cleanupTaskPayload>;
export type ClickHouseSyncTaskPayload = z.infer<
	typeof clickhouseSyncTaskPayload
>;
export type TaskQueuePayload = z.infer<typeof taskQueuePayload>;
export type ValidationError = z.infer<typeof validationError>;
export type ValidationErrors = z.infer<typeof validationErrors>;
export type CronJobPayload = z.infer<typeof cronJobPayload>;
export type CronRunMetadata = z.infer<typeof cronRunMetadata>;
export type ArchiveMetadata = z.infer<typeof archiveMetadata>;
