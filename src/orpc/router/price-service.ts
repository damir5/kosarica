/**
 * Price Service Proxy Router
 *
 * Proxies requests to the Go price-service via generated SDK.
 * Uses goFetchWithRetry for endpoints not yet in the OpenAPI spec.
 */

import * as z from "zod";
import {
	deleteInternalIngestionRunsByRunId,
	getInternalIngestionFilesByFileId,
	getInternalIngestionFilesByFileIdChunks,
	getInternalIngestionFilesByFileIdErrors,
	getInternalIngestionFilesByFileIdStores,
	getInternalIngestionRuns,
	getInternalIngestionRunsByRunId,
	getInternalIngestionRunsByRunIdErrors,
	getInternalIngestionRunsByRunIdFiles,
	getInternalIngestionRunsByRunIdStores,
	getInternalIngestionStats,
	getInternalItemsSearch,
	getInternalPricesByChainSlugByStoreId,
	type HandlersGetStatsResponse,
	type HandlersGetStorePricesResponse,
	type HandlersIngestionFile,
	type HandlersIngestionRun,
	type HandlersListChunksResponse,
	type HandlersListErrorsResponse,
	type HandlersListFilesResponse,
	type HandlersListRunsResponse,
	type HandlersListStoreStatsResponse,
	type HandlersSearchItemsResponse,
	postInternalIngestionRunsByRunIdRerun,
} from "@/lib/go-api";
import { unwrapSdkResponse } from "@/lib/go-api/utils";
import { goFetchWithRetry, unwrapResponse } from "@/lib/go-service-client";
import { procedure } from "../base";

// ============================================================================
// Types
// ============================================================================

// Dynamic chain schema - fetched from Go service at runtime
const ChainSlugSchema = z.string();

const IngestionStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
]);

// ============================================================================
// Ingestion Routes - Monitoring (idempotent, use SDK)
// ============================================================================

/**
 * List ingestion runs with pagination
 * GET /internal/ingestion/runs?chainSlug=&status=&limit=&offset=
 */
export const listRuns = procedure
	.input(
		z
			.object({
				chainSlug: ChainSlugSchema.optional(),
				status: IngestionStatusSchema.optional(),
				limit: z.number().int().min(1).max(100).default(20),
				offset: z.number().int().min(0).default(0),
			})
			.optional(),
	)
	.handler(async ({ input = {} }) => {
		const result = await getInternalIngestionRuns({
			query: {
				chainSlug: input.chainSlug,
				status: input.status,
				limit: input.limit ?? 20,
				offset: input.offset ?? 0,
			},
		});
		return unwrapSdkResponse<HandlersListRunsResponse>(result);
	});

/**
 * Get a single ingestion run by ID
 * GET /internal/ingestion/runs/:runId
 */
export const getRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		const result = await getInternalIngestionRunsByRunId({
			path: { runId: input.runId },
		});
		const data = unwrapSdkResponse<HandlersIngestionRun>(result);
		if (!data) {
			throw new Error(`Run not found: ${input.runId}`);
		}
		return data;
	});

/**
 * List files for a run with pagination
 * GET /internal/ingestion/runs/:runId/files?limit=&offset=
 */
export const listFiles = procedure
	.input(
		z.object({
			runId: z.string(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const result = await getInternalIngestionRunsByRunIdFiles({
			path: { runId: input.runId },
			query: {
				limit: input.limit,
				offset: input.offset,
			},
		});
		return unwrapSdkResponse<HandlersListFilesResponse>(result);
	});

/**
 * List errors for a run with pagination
 * GET /internal/ingestion/runs/:runId/errors?limit=&offset=
 */
export const listErrors = procedure
	.input(
		z.object({
			runId: z.string(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const result = await getInternalIngestionRunsByRunIdErrors({
			path: { runId: input.runId },
			query: {
				limit: input.limit,
				offset: input.offset,
			},
		});
		return unwrapSdkResponse<HandlersListErrorsResponse>(result);
	});

/**
 * List store stats for a run
 * GET /internal/ingestion/runs/:runId/stores?limit=&offset=
 */
export const listRunStoreStats = procedure
	.input(
		z.object({
			runId: z.string(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const result = await getInternalIngestionRunsByRunIdStores({
			path: { runId: input.runId },
			query: {
				limit: input.limit,
				offset: input.offset,
			},
		});
		return unwrapSdkResponse<HandlersListStoreStatsResponse>(result);
	});

/**
 * List store stats for a file
 * GET /internal/ingestion/files/:fileId/stores?limit=&offset=
 */
export const listFileStoreStats = procedure
	.input(
		z.object({
			fileId: z.string(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const result = await getInternalIngestionFilesByFileIdStores({
			path: { fileId: input.fileId },
			query: {
				limit: input.limit,
				offset: input.offset,
			},
		});
		return unwrapSdkResponse<HandlersListStoreStatsResponse>(result);
	});

// Type for transformed stats response matching frontend expectations
export interface IngestionStats {
	timeRange: "24h" | "7d" | "30d";
	runs: {
		total: number;
		pending: number;
		running: number;
		completed: number;
		failed: number;
	};
	files: {
		total: number;
		processed: number;
	};
	entries: {
		total: number;
		processed: number;
	};
	errors: {
		total: number;
		byType: Record<string, number>;
		bySeverity: Record<string, number>;
	};
}

const TIME_RANGE_MS = {
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	"30d": 30 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Get ingestion statistics
 * GET /internal/ingestion/stats?from=&to=
 *
 * Accepts timeRange (24h/7d/30d) and transforms the buckets response
 * into a flat structure matching the frontend's IngestionStats interface.
 */
export const getStats = procedure
	.input(
		z
			.object({
				timeRange: z.enum(["24h", "7d", "30d"]).default("24h"),
			})
			.optional(),
	)
	.handler(async ({ input = {} }): Promise<IngestionStats> => {
		const timeRange = input.timeRange ?? "24h";
		const now = new Date();
		const from = new Date(now.getTime() - TIME_RANGE_MS[timeRange]);

		const result = await getInternalIngestionStats({
			query: {
				from: from.toISOString(),
				to: now.toISOString(),
			},
		});
		const response = unwrapSdkResponse<HandlersGetStatsResponse>(result);
		if (!response) {
			throw new Error("Failed to get ingestion stats");
		}

		// Find the matching bucket or use the first one
		const bucket =
			response.buckets?.find((b) => b.label === timeRange) ??
			response.buckets?.[0];

		// Transform buckets response to flat IngestionStats structure
		return {
			timeRange,
			runs: {
				total: bucket?.totalRuns ?? 0,
				pending: bucket?.pending ?? 0,
				running: bucket?.running ?? 0,
				completed: bucket?.completed ?? 0,
				failed: bucket?.failed ?? 0,
			},
			files: {
				total: bucket?.totalFiles ?? 0,
				processed: bucket?.totalFiles ?? 0, // API doesn't distinguish processed
			},
			entries: {
				total: 0, // Not provided by API
				processed: 0,
			},
			errors: {
				total: bucket?.totalErrors ?? 0,
				byType: {}, // Not provided by bucket API
				bySeverity: {},
			},
		};
	});

// ============================================================================
// Ingestion Routes - Actions (non-idempotent)
// ============================================================================

/**
 * Trigger ingestion for a chain
 * POST /internal/admin/ingest/:chain
 * Simple proxy to Go service - no retry logic, no timeout, no duplicate checks
 * Go handles everything: duplicate detection, queueing, execution
 */
export const triggerChain = procedure
	.input(
		z.object({
			chain: ChainSlugSchema,
			targetDate: z.string().optional(), // YYYY-MM-DD format
			priority: z.number().optional().default(0), // 0=normal, higher=more urgent
			force: z.boolean().optional().default(false), // Force re-ingestion
		}),
	)
	.handler(async ({ input }) => {
		// Simple validation only
		if (!input.chain) {
			throw new Error("Chain is required");
		}

		// Forward to Go service - no timeout, no retries
		// Go handles everything: duplicate detection, queueing, execution
		const response = await goFetchWithRetry(
			`/internal/admin/ingest/${input.chain}`,
			{
				method: "POST",
				body: JSON.stringify({
					targetDate: input.targetDate,
					priority: input.priority,
					force: input.force,
				}),
				// No timeout - let Go respond immediately (202 or 200)
			},
		);
		return unwrapResponse(response);
	});

/**
 * Rerun a failed ingestion run
 * POST /internal/ingestion/runs/:runId/rerun
 */
export const rerunRun = procedure
	.input(
		z.object({
			runId: z.string(),
			rerunType: z.enum(["file", "chunk", "entry"]).default("file"),
			targetId: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const result = await postInternalIngestionRunsByRunIdRerun({
			path: { runId: input.runId },
			body: {
				rerunType: input.rerunType,
				targetId: input.targetId,
			},
		});
		return unwrapSdkResponse(result);
	});

/**
 * Delete an ingestion run
 * DELETE /internal/ingestion/runs/:runId
 */
export const deleteRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		const result = await deleteInternalIngestionRunsByRunId({
			path: { runId: input.runId },
		});
		return unwrapSdkResponse(result);
	});

/**
 * Get a single file by ID
 * GET /internal/ingestion/files/:fileId
 */
export const getFile = procedure
	.input(z.object({ fileId: z.string() }))
	.handler(async ({ input }) => {
		const result = await getInternalIngestionFilesByFileId({
			path: { fileId: input.fileId },
		});
		const data = unwrapSdkResponse<HandlersIngestionFile>(result);
		if (!data) {
			throw new Error(`File not found: ${input.fileId}`);
		}
		return data;
	});

/**
 * List chunks for a file with pagination
 * GET /internal/ingestion/files/:fileId/chunks?status=&page=&pageSize=
 */
export const listChunks = procedure
	.input(
		z.object({
			fileId: z.string(),
			status: z
				.enum(["pending", "processing", "completed", "failed"])
				.optional(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const result = await getInternalIngestionFilesByFileIdChunks({
			path: { fileId: input.fileId },
			query: {
				status: input.status,
				page: input.page,
				pageSize: input.pageSize,
			},
		});
		return unwrapSdkResponse<HandlersListChunksResponse>(result);
	});

/**
 * Rerun a file
 * POST /internal/ingestion/files/:fileId/rerun
 * Note: Not in OpenAPI spec yet - using goFetchWithRetry
 */
export const rerunFile = procedure
	.input(z.object({ fileId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(
			`/internal/ingestion/files/${input.fileId}/rerun`,
			{
				method: "POST",
				timeout: 10000,
			},
		);
		return unwrapResponse(response);
	});

/**
 * Rerun a chunk
 * POST /internal/ingestion/chunks/:chunkId/rerun
 * Note: Not in OpenAPI spec yet - using goFetchWithRetry
 */
export const rerunChunk = procedure
	.input(z.object({ chunkId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(
			`/internal/ingestion/chunks/${input.chunkId}/rerun`,
			{
				method: "POST",
				timeout: 10000,
			},
		);
		return unwrapResponse(response);
	});

/**
 * List errors for a file with pagination
 * GET /internal/ingestion/files/:fileId/errors?page=&pageSize=
 */
export const listFileErrors = procedure
	.input(
		z.object({
			fileId: z.string(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(10),
		}),
	)
	.handler(async ({ input }) => {
		const result = await getInternalIngestionFilesByFileIdErrors({
			path: { fileId: input.fileId },
			query: {
				page: input.page,
				pageSize: input.pageSize,
			},
		});
		return unwrapSdkResponse<HandlersListErrorsResponse>(result);
	});

// ============================================================================
// Price Routes
// ============================================================================

/**
 * Get prices for a specific store
 * GET /internal/prices/:chainSlug/:storeId?limit=&offset=
 */
export const getStorePrices = procedure
	.input(
		z.object({
			chainSlug: ChainSlugSchema,
			storeId: z.string(),
			limit: z.number().int().min(1).max(1000).default(100),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const result = await getInternalPricesByChainSlugByStoreId({
			path: {
				chainSlug: input.chainSlug,
				storeId: input.storeId,
			},
			query: {
				limit: input.limit,
				offset: input.offset,
			},
		});
		return unwrapSdkResponse<HandlersGetStorePricesResponse>(result);
	});

/**
 * Search for items by name
 * GET /internal/items/search?q=&chainSlug=&limit=
 * Requires minimum 3 characters for search
 */
export const searchItems = procedure
	.input(
		z.object({
			query: z.string().min(3, "Search query must be at least 3 characters"),
			chainSlug: ChainSlugSchema.optional(),
			limit: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const result = await getInternalItemsSearch({
			query: {
				q: input.query,
				chainSlug: input.chainSlug,
				limit: input.limit,
			},
		});
		return unwrapSdkResponse<HandlersSearchItemsResponse>(result);
	});

// ============================================================================
// Price Groups Routes
// Note: Not in OpenAPI spec yet - using goFetchWithRetry
// ============================================================================

/**
 * Get store prices via price group
 * GET /internal/prices/group/:storeId
 */
export const getStorePricesGroup = procedure
	.input(
		z.object({
			storeId: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(
			`/internal/prices/group/${input.storeId}`,
			{
				timeout: 5000,
			},
		);
		return unwrapResponse(response);
	});

/**
 * Get historical price for an item at a store
 * GET /internal/prices/history?storeId=&itemId=&asOf=
 */
export const getHistoricalPrice = procedure
	.input(
		z.object({
			storeId: z.string(),
			itemId: z.string(),
			asOf: z.string().optional(), // RFC3339 timestamp
		}),
	)
	.handler(async ({ input }) => {
		const params = new URLSearchParams({
			storeId: input.storeId,
			itemId: input.itemId,
		});

		if (input.asOf) {
			params.set("asOf", input.asOf);
		}

		const response = await goFetchWithRetry(
			`/internal/prices/history?${params.toString()}`,
			{
				timeout: 5000,
			},
		);
		return unwrapResponse(response);
	});

/**
 * List price groups for a chain
 * GET /internal/price-groups/:chainSlug?limit=&offset=
 */
export const listPriceGroups = procedure
	.input(
		z.object({
			chainSlug: ChainSlugSchema,
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const params = new URLSearchParams({
			limit: input.limit.toString(),
			offset: input.offset.toString(),
		});

		const response = await goFetchWithRetry(
			`/internal/price-groups/${input.chainSlug}?${params.toString()}`,
			{ timeout: 5000 },
		);
		return unwrapResponse(response);
	});

// ============================================================================
// Chains Routes
// Note: Not in OpenAPI spec yet - using goFetchWithRetry
// ============================================================================

/**
 * List valid chain slugs
 * GET /internal/chains
 */
export const listChains = procedure.handler(async () => {
	const response = await goFetchWithRetry("/internal/chains", {
		timeout: 5000,
	});
	return unwrapResponse(response);
});
