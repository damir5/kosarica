/**
 * Price Service Proxy Router
 *
 * Proxies requests to the Go price-service via generated SDK.
 * Uses goFetchWithRetry for endpoints not yet in the OpenAPI spec.
 */

import * as z from "zod";
import {
	deleteInternalIngestionRunsByRunId,
	getInternalIngestionRuns,
	getInternalIngestionRunsByRunId,
	getInternalIngestionRunsByRunIdErrors,
	getInternalIngestionRunsByRunIdFiles,
	getInternalIngestionStats,
	getInternalItemsSearch,
	getInternalPricesByChainSlugByStoreId,
	type HandlersGetStatsResponse,
	type HandlersGetStorePricesResponse,
	type HandlersIngestionRun,
	type HandlersListErrorsResponse,
	type HandlersListFilesResponse,
	type HandlersListRunsResponse,
	type HandlersSearchItemsResponse,
	postInternalIngestionRunsByRunIdRerun,
} from "@/lib/go-api";
import { unwrapSdkResponse } from "@/lib/go-api/client-config";
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
		return unwrapSdkResponse<HandlersIngestionRun>(result);
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
 * Get ingestion statistics
 * GET /internal/ingestion/stats?from=&to=
 */
export const getStats = procedure
	.input(
		z
			.object({
				from: z.string().optional(), // ISO date string
				to: z.string().optional(), // ISO date string
			})
			.optional(),
	)
	.handler(async ({ input = {} }) => {
		// The SDK requires from/to - provide defaults if not specified
		const now = new Date();
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		const result = await getInternalIngestionStats({
			query: {
				from: input.from ?? thirtyDaysAgo.toISOString(),
				to: input.to ?? now.toISOString(),
			},
		});
		return unwrapSdkResponse<HandlersGetStatsResponse>(result);
	});

// ============================================================================
// Ingestion Routes - Actions (non-idempotent)
// ============================================================================

/**
 * Trigger ingestion for a chain
 * POST /internal/admin/ingest/:chain
 * Note: Not in OpenAPI spec yet - using goFetchWithRetry
 */
export const triggerChain = procedure
	.input(
		z.object({
			chain: ChainSlugSchema,
			targetDate: z.string().optional(), // YYYY-MM-DD format
		}),
	)
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(
			`/internal/admin/ingest/${input.chain}`,
			{
				method: "POST",
				body: input.targetDate
					? JSON.stringify({ targetDate: input.targetDate })
					: undefined,
				timeout: 10000, // 10s timeout - should return 202 immediately
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
 * Note: Not in OpenAPI spec yet - using goFetchWithRetry
 */
export const getFile = procedure
	.input(z.object({ fileId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(
			`/internal/ingestion/files/${input.fileId}`,
			{
				timeout: 5000,
			},
		);
		return unwrapResponse(response);
	});

/**
 * List chunks for a file with pagination
 * GET /internal/ingestion/files/:fileId/chunks?status=&page=&pageSize=
 * Note: Not in OpenAPI spec yet - using goFetchWithRetry
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
		const params = new URLSearchParams({
			page: input.page.toString(),
			pageSize: input.pageSize.toString(),
		});

		if (input.status) {
			params.set("status", input.status);
		}

		const response = await goFetchWithRetry(
			`/internal/ingestion/files/${input.fileId}/chunks?${params.toString()}`,
			{ timeout: 5000 },
		);
		return unwrapResponse(response);
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
 * Note: Not in OpenAPI spec yet - using goFetchWithRetry
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
		const params = new URLSearchParams({
			page: input.page.toString(),
			pageSize: input.pageSize.toString(),
		});

		const response = await goFetchWithRetry(
			`/internal/ingestion/files/${input.fileId}/errors?${params.toString()}`,
			{ timeout: 5000 },
		);
		return unwrapResponse(response);
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
