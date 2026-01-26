/**
 * Auto-generated Zod schemas from Go types
 * DO NOT EDIT - regenerate with: pnpm schema:generate
 *
 * Source: shared/schemas/ingestion.json
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

export const GetStatsRequestSchema = z.object({
	from: z.string(),
	to: z.string(),
});

export const GetStatsResponseSchema = z.object({
	buckets: z.array(
		z.object({
			label: z.string(),
			totalRuns: z.number().int(),
			completed: z.number().int(),
			failed: z.number().int(),
			running: z.number().int(),
			pending: z.number().int(),
			totalFiles: z.number().int(),
			totalErrors: z.number().int(),
		}),
	),
});

export const IngestionErrorSchema = z.object({
	id: z.string(),
	runId: z.string(),
	fileId: z.string(),
	chunkId: z.string(),
	entryId: z.string(),
	errorType: z.string(),
	errorMessage: z.string(),
	errorDetails: z.string(),
	severity: z.enum(["warning", "error", "critical"]),
	createdAt: z.string().datetime({ offset: true }),
});

export const IngestionFileSchema = z.object({
	id: z.string(),
	runId: z.string(),
	filename: z.string(),
	fileType: z.string(),
	fileSize: z.number().int(),
	fileHash: z.string(),
	status: z.enum(["pending", "processing", "completed", "failed"]),
	entryCount: z.number().int(),
	processedAt: z.string().datetime({ offset: true }),
	metadata: z.string(),
	totalChunks: z.number().int(),
	processedChunks: z.number().int(),
	chunkSize: z.number().int(),
	createdAt: z.string().datetime({ offset: true }),
});

export const IngestionRunSchema = z.object({
	id: z.string(),
	chainSlug: z.string(),
	source: z.string(),
	status: z.enum(["pending", "running", "completed", "failed"]),
	startedAt: z.string().datetime({ offset: true }),
	completedAt: z.string().datetime({ offset: true }),
	totalFiles: z.number().int(),
	processedFiles: z.number().int(),
	totalEntries: z.number().int(),
	processedEntries: z.number().int(),
	errorCount: z.number().int(),
	metadata: z.string(),
	createdAt: z.string().datetime({ offset: true }),
});

export const ListChainsResponseSchema = z.object({
	chains: z.array(z.string()),
});

export const ListErrorsRequestSchema = z.object({
	limit: z.number().int().gte(1).lte(100),
	offset: z.number().int().gte(0),
});

export const ListErrorsResponseSchema = z.object({
	errors: z.array(
		z.object({
			id: z.string(),
			runId: z.string(),
			fileId: z.string(),
			chunkId: z.string(),
			entryId: z.string(),
			errorType: z.string(),
			errorMessage: z.string(),
			errorDetails: z.string(),
			severity: z.enum(["warning", "error", "critical"]),
			createdAt: z.string().datetime({ offset: true }),
		}),
	),
	total: z.number().int(),
});

export const ListFilesRequestSchema = z.object({
	limit: z.number().int().gte(1).lte(100),
	offset: z.number().int().gte(0),
});

export const ListFilesResponseSchema = z.object({
	files: z.array(
		z.object({
			id: z.string(),
			runId: z.string(),
			filename: z.string(),
			fileType: z.string(),
			fileSize: z.number().int(),
			fileHash: z.string(),
			status: z.enum(["pending", "processing", "completed", "failed"]),
			entryCount: z.number().int(),
			processedAt: z.string().datetime({ offset: true }),
			metadata: z.string(),
			totalChunks: z.number().int(),
			processedChunks: z.number().int(),
			chunkSize: z.number().int(),
			createdAt: z.string().datetime({ offset: true }),
		}),
	),
	total: z.number().int(),
});

export const ListRunsRequestSchema = z.object({
	chainSlug: z.string(),
	status: z.enum(["pending", "running", "completed", "failed"]),
	limit: z.number().int().gte(1).lte(100),
	offset: z.number().int().gte(0),
});

export const ListRunsResponseSchema = z.object({
	runs: z.array(
		z.object({
			id: z.string(),
			chainSlug: z.string(),
			source: z.string(),
			status: z.enum(["pending", "running", "completed", "failed"]),
			startedAt: z.string().datetime({ offset: true }),
			completedAt: z.string().datetime({ offset: true }),
			totalFiles: z.number().int(),
			processedFiles: z.number().int(),
			totalEntries: z.number().int(),
			processedEntries: z.number().int(),
			errorCount: z.number().int(),
			metadata: z.string(),
			createdAt: z.string().datetime({ offset: true }),
		}),
	),
	total: z.number().int(),
});

export const RerunRunRequestSchema = z.object({
	rerunType: z.enum(["file", "chunk", "entry"]),
	targetId: z.string(),
});

export const StatsBucketSchema = z.object({
	label: z.string(),
	totalRuns: z.number().int(),
	completed: z.number().int(),
	failed: z.number().int(),
	running: z.number().int(),
	pending: z.number().int(),
	totalFiles: z.number().int(),
	totalErrors: z.number().int(),
});

// ============================================================================
// Types
// ============================================================================

export type GetStatsRequest = z.infer<typeof GetStatsRequestSchema>;
export type GetStatsResponse = z.infer<typeof GetStatsResponseSchema>;
export type IngestionError = z.infer<typeof IngestionErrorSchema>;
export type IngestionFile = z.infer<typeof IngestionFileSchema>;
export type IngestionRun = z.infer<typeof IngestionRunSchema>;
export type ListChainsResponse = z.infer<typeof ListChainsResponseSchema>;
export type ListErrorsRequest = z.infer<typeof ListErrorsRequestSchema>;
export type ListErrorsResponse = z.infer<typeof ListErrorsResponseSchema>;
export type ListFilesRequest = z.infer<typeof ListFilesRequestSchema>;
export type ListFilesResponse = z.infer<typeof ListFilesResponseSchema>;
export type ListRunsRequest = z.infer<typeof ListRunsRequestSchema>;
export type ListRunsResponse = z.infer<typeof ListRunsResponseSchema>;
export type RerunRunRequest = z.infer<typeof RerunRunRequestSchema>;
export type StatsBucket = z.infer<typeof StatsBucketSchema>;
