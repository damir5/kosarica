/**
 * Price Service Proxy Router
 *
 * Proxies requests to the Go price-service via internal API.
 * Uses goFetch/goFetchWithRetry for resilient communication.
 */

import * as z from "zod";
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
// Ingestion Routes - Monitoring (idempotent, use retry)
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
		const limit = input.limit ?? 20;
		const offset = input.offset ?? 0;
		const params = new URLSearchParams({
			limit: limit.toString(),
			offset: offset.toString(),
		});

		if (input.chainSlug) {
			params.set("chainSlug", input.chainSlug);
		}
		if (input.status) {
			params.set("status", input.status);
		}

		const response = await goFetchWithRetry(`/internal/ingestion/runs?${params.toString()}`, {
			timeout: 5000,
		});
		return unwrapResponse(response);
	});

/**
 * Get a single ingestion run by ID
 * GET /internal/ingestion/runs/:runId
 */
export const getRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(`/internal/ingestion/runs/${input.runId}`, {
			timeout: 5000,
		});
		return unwrapResponse(response);
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
		const params = new URLSearchParams({
			limit: input.limit.toString(),
			offset: input.offset.toString(),
		});

		const response = await goFetchWithRetry(
			`/internal/ingestion/runs/${input.runId}/files?${params.toString()}`,
			{ timeout: 5000 },
		);
		return unwrapResponse(response);
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
		const params = new URLSearchParams({
			limit: input.limit.toString(),
			offset: input.offset.toString(),
		});

		const response = await goFetchWithRetry(
			`/internal/ingestion/runs/${input.runId}/errors?${params.toString()}`,
			{ timeout: 5000 },
		);
		return unwrapResponse(response);
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
		const params = new URLSearchParams();
		if (input.from) {
			params.set("from", input.from);
		}
		if (input.to) {
			params.set("to", input.to);
		}

		const response = await goFetchWithRetry(
			`/internal/ingestion/stats${params.toString() ? `?${params.toString()}` : ""}`,
			{ timeout: 10000 }, // Longer timeout for stats
		);
		return unwrapResponse(response);
	});

// ============================================================================
// Ingestion Routes - Actions (non-idempotent, no retry)
// ============================================================================

/**
 * Trigger ingestion for a chain
 * POST /internal/admin/ingest/:chain
 */
export const triggerChain = procedure
	.input(
		z.object({
			chain: ChainSlugSchema,
			targetDate: z.string().optional(), // YYYY-MM-DD format
		}),
	)
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(`/internal/admin/ingest/${input.chain}`, {
			method: "POST",
			body: input.targetDate
				? JSON.stringify({ targetDate: input.targetDate })
				: undefined,
			timeout: 10000, // 10s timeout - should return 202 immediately
		});
		return unwrapResponse(response);
	});

/**
 * Rerun a failed ingestion run
 * POST /internal/ingestion/runs/:runId/rerun
 */
export const rerunRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(`/internal/ingestion/runs/${input.runId}/rerun`, {
			method: "POST",
			timeout: 10000,
		});
		return unwrapResponse(response);
	});

/**
 * Delete an ingestion run
 * DELETE /internal/ingestion/runs/:runId
 */
export const deleteRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(`/internal/ingestion/runs/${input.runId}`, {
			method: "DELETE",
			timeout: 5000,
		});
		return unwrapResponse(response);
	});

/**
 * Get a single file by ID
 * GET /internal/ingestion/files/:fileId
 */
export const getFile = procedure
	.input(z.object({ fileId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(`/internal/ingestion/files/${input.fileId}`, {
			timeout: 5000,
		});
		return unwrapResponse(response);
	});

/**
 * List chunks for a file with pagination
 * GET /internal/ingestion/files/:fileId/chunks?status=&page=&pageSize=
 */
export const listChunks = procedure
	.input(
		z.object({
			fileId: z.string(),
			status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
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
 */
export const rerunFile = procedure
	.input(z.object({ fileId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(`/internal/ingestion/files/${input.fileId}/rerun`, {
			method: "POST",
			timeout: 10000,
		});
		return unwrapResponse(response);
	});

/**
 * Rerun a chunk
 * POST /internal/ingestion/chunks/:chunkId/rerun
 */
export const rerunChunk = procedure
	.input(z.object({ chunkId: z.string() }))
	.handler(async ({ input }) => {
		const response = await goFetchWithRetry(`/internal/ingestion/chunks/${input.chunkId}/rerun`, {
			method: "POST",
			timeout: 10000,
		});
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
		const params = new URLSearchParams({
			limit: input.limit.toString(),
			offset: input.offset.toString(),
		});

		const response = await goFetchWithRetry(
			`/internal/prices/${input.chainSlug}/${input.storeId}?${params.toString()}`,
			{ timeout: 5000 },
		);
		return unwrapResponse(response);
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
		const params = new URLSearchParams({
			q: input.query,
			limit: input.limit.toString(),
		});

		if (input.chainSlug) {
			params.set("chainSlug", input.chainSlug);
		}

		const response = await goFetchWithRetry(`/internal/items/search?${params.toString()}`, {
			timeout: 5000,
		});
		return unwrapResponse(response);
	});

// ============================================================================
// Price Groups Routes
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
		const response = await goFetchWithRetry(`/internal/prices/group/${input.storeId}`, {
			timeout: 5000,
		});
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

		const response = await goFetchWithRetry(`/internal/prices/history?${params.toString()}`, {
			timeout: 5000,
		});
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
// ============================================================================

/**
 * List valid chain slugs
 * GET /internal/chains
 */
export const listChains = procedure.handler(async () => {
	const response = await goFetchWithRetry("/internal/chains", { timeout: 5000 });
	return unwrapResponse(response);
});
