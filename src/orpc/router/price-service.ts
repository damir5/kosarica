/**
 * Price Service Proxy Router
 *
 * Proxies requests to the Go price-service via internal API.
 * Uses goFetch/goFetchWithRetry for resilient communication.
 */

import * as z from "zod";
import { goFetch, goFetchWithRetry } from "@/lib/go-service-client";
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

		return goFetchWithRetry(
			`/internal/ingestion/runs?${params.toString()}`,
			{ timeout: 5000 },
		);
	});

/**
 * Get a single ingestion run by ID
 * GET /internal/ingestion/runs/:runId
 */
export const getRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		return goFetchWithRetry(`/internal/ingestion/runs/${input.runId}`, {
			timeout: 5000,
		});
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

		return goFetchWithRetry(
			`/internal/ingestion/runs/${input.runId}/files?${params.toString()}`,
			{ timeout: 5000 },
		);
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

		return goFetchWithRetry(
			`/internal/ingestion/runs/${input.runId}/errors?${params.toString()}`,
			{ timeout: 5000 },
		);
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

		return goFetchWithRetry(
			`/internal/ingestion/stats${params.toString() ? `?${params.toString()}` : ""}`,
			{ timeout: 10000 }, // Longer timeout for stats
		);
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
		return goFetch(
			`/internal/admin/ingest/${input.chain}`,
			{
				method: "POST",
				body: input.targetDate ? JSON.stringify({ targetDate: input.targetDate }) : undefined,
				timeout: 10000, // 10s timeout - should return 202 immediately
			},
		);
	});

/**
 * Rerun a failed ingestion run
 * POST /internal/ingestion/runs/:runId/rerun
 */
export const rerunRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		return goFetch(`/internal/ingestion/runs/${input.runId}/rerun`, {
			method: "POST",
			timeout: 10000,
		});
	});

/**
 * Delete an ingestion run
 * DELETE /internal/ingestion/runs/:runId
 */
export const deleteRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		return goFetch(`/internal/ingestion/runs/${input.runId}`, {
			method: "DELETE",
			timeout: 5000,
		});
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

		return goFetchWithRetry(
			`/internal/prices/${input.chainSlug}/${input.storeId}?${params.toString()}`,
			{ timeout: 5000 },
		);
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

		return goFetchWithRetry(
			`/internal/items/search?${params.toString()}`,
			{ timeout: 5000 },
		);
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
		return goFetchWithRetry(`/internal/prices/group/${input.storeId}`, {
			timeout: 5000,
		});
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

		return goFetchWithRetry(
			`/internal/prices/history?${params.toString()}`,
			{ timeout: 5000 },
		);
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

		return goFetchWithRetry(
			`/internal/price-groups/${input.chainSlug}?${params.toString()}`,
			{ timeout: 5000 },
		);
	});

// ============================================================================
// Chains Routes
// ============================================================================

/**
 * List valid chain slugs
 * GET /internal/chains
 */
export const listChains = procedure.handler(async () => {
	return goFetchWithRetry("/internal/chains", { timeout: 5000 });
});
