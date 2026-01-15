import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import * as z from "zod";
import {
	chains,
	ingestionChunks,
	ingestionErrors,
	ingestionFiles,
	ingestionRuns,
} from "@/db/schema";
import { CHAIN_CONFIGS, isValidChainId } from "@/ingestion/chains/config";
import type { DiscoverQueueMessage } from "@/ingestion/core/types";
import { getDb, getEnv } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { procedure } from "../base";

// ============================================================================
// Monitoring Endpoints
// ============================================================================

export const listRuns = procedure
	.input(
		z.object({
			chainSlug: z.string().optional(),
			status: z.enum(["pending", "running", "completed", "failed"]).optional(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const offset = (input.page - 1) * input.pageSize;

		const conditions = [];
		if (input.chainSlug) {
			conditions.push(eq(ingestionRuns.chainSlug, input.chainSlug));
		}
		if (input.status) {
			conditions.push(eq(ingestionRuns.status, input.status));
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const [runs, totalResult] = await Promise.all([
			db
				.select()
				.from(ingestionRuns)
				.where(whereClause)
				.orderBy(desc(ingestionRuns.createdAt))
				.limit(input.pageSize)
				.offset(offset),
			db.select({ count: count() }).from(ingestionRuns).where(whereClause),
		]);

		return {
			runs,
			total: totalResult[0]?.count ?? 0,
			page: input.page,
			pageSize: input.pageSize,
			totalPages: Math.ceil((totalResult[0]?.count ?? 0) / input.pageSize),
		};
	});

export const getRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const result = await db
			.select()
			.from(ingestionRuns)
			.where(eq(ingestionRuns.id, input.runId));

		if (result.length === 0) {
			throw new Error("Run not found");
		}
		return result[0];
	});

export const listFiles = procedure
	.input(
		z.object({
			runId: z.string(),
			status: z
				.enum(["pending", "processing", "completed", "failed"])
				.optional(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const offset = (input.page - 1) * input.pageSize;

		const conditions = [eq(ingestionFiles.runId, input.runId)];
		if (input.status) {
			conditions.push(eq(ingestionFiles.status, input.status));
		}

		const whereClause = and(...conditions);

		const [files, totalResult] = await Promise.all([
			db
				.select()
				.from(ingestionFiles)
				.where(whereClause)
				.orderBy(desc(ingestionFiles.createdAt))
				.limit(input.pageSize)
				.offset(offset),
			db.select({ count: count() }).from(ingestionFiles).where(whereClause),
		]);

		return {
			files,
			total: totalResult[0]?.count ?? 0,
			page: input.page,
			pageSize: input.pageSize,
			totalPages: Math.ceil((totalResult[0]?.count ?? 0) / input.pageSize),
		};
	});

export const getFile = procedure
	.input(z.object({ fileId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const result = await db
			.select()
			.from(ingestionFiles)
			.where(eq(ingestionFiles.id, input.fileId));

		if (result.length === 0) {
			throw new Error("File not found");
		}
		return result[0];
	});

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
		const db = getDb();
		const offset = (input.page - 1) * input.pageSize;

		const conditions = [eq(ingestionChunks.fileId, input.fileId)];
		if (input.status) {
			conditions.push(eq(ingestionChunks.status, input.status));
		}

		const whereClause = and(...conditions);

		const [chunks, totalResult] = await Promise.all([
			db
				.select()
				.from(ingestionChunks)
				.where(whereClause)
				.orderBy(ingestionChunks.chunkIndex)
				.limit(input.pageSize)
				.offset(offset),
			db.select({ count: count() }).from(ingestionChunks).where(whereClause),
		]);

		return {
			chunks,
			total: totalResult[0]?.count ?? 0,
			page: input.page,
			pageSize: input.pageSize,
			totalPages: Math.ceil((totalResult[0]?.count ?? 0) / input.pageSize),
		};
	});

export const getChunk = procedure
	.input(z.object({ chunkId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const result = await db
			.select()
			.from(ingestionChunks)
			.where(eq(ingestionChunks.id, input.chunkId));

		if (result.length === 0) {
			throw new Error("Chunk not found");
		}
		return result[0];
	});

export const listErrors = procedure
	.input(
		z.object({
			runId: z.string().optional(),
			fileId: z.string().optional(),
			chunkId: z.string().optional(),
			errorType: z.string().optional(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const offset = (input.page - 1) * input.pageSize;

		const conditions = [];
		if (input.runId) {
			conditions.push(eq(ingestionErrors.runId, input.runId));
		}
		if (input.fileId) {
			conditions.push(eq(ingestionErrors.fileId, input.fileId));
		}
		if (input.chunkId) {
			conditions.push(eq(ingestionErrors.chunkId, input.chunkId));
		}
		if (input.errorType) {
			conditions.push(eq(ingestionErrors.errorType, input.errorType));
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const [errors, totalResult] = await Promise.all([
			db
				.select()
				.from(ingestionErrors)
				.where(whereClause)
				.orderBy(desc(ingestionErrors.createdAt))
				.limit(input.pageSize)
				.offset(offset),
			db.select({ count: count() }).from(ingestionErrors).where(whereClause),
		]);

		return {
			errors,
			total: totalResult[0]?.count ?? 0,
			page: input.page,
			pageSize: input.pageSize,
			totalPages: Math.ceil((totalResult[0]?.count ?? 0) / input.pageSize),
		};
	});

// ============================================================================
// Stats Endpoint
// ============================================================================

export const getStats = procedure
	.input(
		z.object({
			timeRange: z.enum(["24h", "7d", "30d"]),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		// Calculate the start timestamp based on time range
		const now = Math.floor(Date.now() / 1000);
		const hoursMap = { "24h": 24, "7d": 168, "30d": 720 };
		const hoursAgo = hoursMap[input.timeRange];
		const startTimestamp = now - hoursAgo * 3600;

		// Get run stats
		const runStats = await db
			.select({
				total: count(),
				pending: sql<number>`sum(case when ${ingestionRuns.status} = 'pending' then 1 else 0 end)`,
				running: sql<number>`sum(case when ${ingestionRuns.status} = 'running' then 1 else 0 end)`,
				completed: sql<number>`sum(case when ${ingestionRuns.status} = 'completed' then 1 else 0 end)`,
				failed: sql<number>`sum(case when ${ingestionRuns.status} = 'failed' then 1 else 0 end)`,
				totalFiles: sql<number>`sum(${ingestionRuns.totalFiles})`,
				processedFiles: sql<number>`sum(${ingestionRuns.processedFiles})`,
				totalEntries: sql<number>`sum(${ingestionRuns.totalEntries})`,
				processedEntries: sql<number>`sum(${ingestionRuns.processedEntries})`,
				errorCount: sql<number>`sum(${ingestionRuns.errorCount})`,
			})
			.from(ingestionRuns)
			.where(gte(ingestionRuns.createdAt, new Date(startTimestamp * 1000)));

		// Get error breakdown by type
		const errorBreakdown = await db
			.select({
				errorType: ingestionErrors.errorType,
				count: count(),
			})
			.from(ingestionErrors)
			.where(gte(ingestionErrors.createdAt, new Date(startTimestamp * 1000)))
			.groupBy(ingestionErrors.errorType);

		// Get error breakdown by severity
		const severityBreakdown = await db
			.select({
				severity: ingestionErrors.severity,
				count: count(),
			})
			.from(ingestionErrors)
			.where(gte(ingestionErrors.createdAt, new Date(startTimestamp * 1000)))
			.groupBy(ingestionErrors.severity);

		return {
			timeRange: input.timeRange,
			runs: {
				total: runStats[0]?.total ?? 0,
				pending: runStats[0]?.pending ?? 0,
				running: runStats[0]?.running ?? 0,
				completed: runStats[0]?.completed ?? 0,
				failed: runStats[0]?.failed ?? 0,
			},
			files: {
				total: runStats[0]?.totalFiles ?? 0,
				processed: runStats[0]?.processedFiles ?? 0,
			},
			entries: {
				total: runStats[0]?.totalEntries ?? 0,
				processed: runStats[0]?.processedEntries ?? 0,
			},
			errors: {
				total: runStats[0]?.errorCount ?? 0,
				byType: errorBreakdown.reduce(
					(acc, item) => {
						acc[item.errorType] = item.count;
						return acc;
					},
					{} as Record<string, number>,
				),
				bySeverity: severityBreakdown.reduce(
					(acc, item) => {
						acc[item.severity] = item.count;
						return acc;
					},
					{} as Record<string, number>,
				),
			},
		};
	});

// ============================================================================
// Re-run Endpoints
// ============================================================================

export const rerunRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Get the original run
		const originalRun = await db
			.select()
			.from(ingestionRuns)
			.where(eq(ingestionRuns.id, input.runId));

		if (originalRun.length === 0) {
			throw new Error("Run not found");
		}

		const run = originalRun[0];

		// Create a new run with reference to the parent
		const newRunId = generatePrefixedId("igr");
		await db.insert(ingestionRuns).values({
			id: newRunId,
			chainSlug: run.chainSlug,
			source: "worker",
			status: "pending",
			totalFiles: 0,
			processedFiles: 0,
			totalEntries: 0,
			processedEntries: 0,
			errorCount: 0,
			parentRunId: input.runId,
			rerunType: null, // Full run rerun
			rerunTargetId: input.runId,
		});

		return {
			success: true,
			newRunId,
			message: `Created rerun for run ${input.runId}`,
		};
	});

export const rerunFile = procedure
	.input(z.object({ fileId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Get the file and its run
		const file = await db
			.select()
			.from(ingestionFiles)
			.where(eq(ingestionFiles.id, input.fileId));

		if (file.length === 0) {
			throw new Error("File not found");
		}

		const originalRun = await db
			.select()
			.from(ingestionRuns)
			.where(eq(ingestionRuns.id, file[0].runId));

		if (originalRun.length === 0) {
			throw new Error("Parent run not found");
		}

		// Create a new run for the file rerun
		const newRunId = generatePrefixedId("igr");
		await db.insert(ingestionRuns).values({
			id: newRunId,
			chainSlug: originalRun[0].chainSlug,
			source: "worker",
			status: "pending",
			totalFiles: 0,
			processedFiles: 0,
			totalEntries: 0,
			processedEntries: 0,
			errorCount: 0,
			parentRunId: file[0].runId,
			rerunType: "file",
			rerunTargetId: input.fileId,
		});

		return {
			success: true,
			newRunId,
			message: `Created rerun for file ${input.fileId}`,
		};
	});

export const rerunChunk = procedure
	.input(z.object({ chunkId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Get the chunk, file, and run
		const chunk = await db
			.select()
			.from(ingestionChunks)
			.where(eq(ingestionChunks.id, input.chunkId));

		if (chunk.length === 0) {
			throw new Error("Chunk not found");
		}

		const file = await db
			.select()
			.from(ingestionFiles)
			.where(eq(ingestionFiles.id, chunk[0].fileId));

		if (file.length === 0) {
			throw new Error("Parent file not found");
		}

		const originalRun = await db
			.select()
			.from(ingestionRuns)
			.where(eq(ingestionRuns.id, file[0].runId));

		if (originalRun.length === 0) {
			throw new Error("Parent run not found");
		}

		// Create a new run for the chunk rerun
		const newRunId = generatePrefixedId("igr");
		await db.insert(ingestionRuns).values({
			id: newRunId,
			chainSlug: originalRun[0].chainSlug,
			source: "worker",
			status: "pending",
			totalFiles: 0,
			processedFiles: 0,
			totalEntries: 0,
			processedEntries: 0,
			errorCount: 0,
			parentRunId: file[0].runId,
			rerunType: "chunk",
			rerunTargetId: input.chunkId,
		});

		return {
			success: true,
			newRunId,
			message: `Created rerun for chunk ${input.chunkId}`,
		};
	});

// ============================================================================
// Delete Endpoints
// ============================================================================

export const deleteRun = procedure
	.input(z.object({ runId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Check if run exists
		const run = await db
			.select()
			.from(ingestionRuns)
			.where(eq(ingestionRuns.id, input.runId));

		if (run.length === 0) {
			throw new Error("Run not found");
		}

		// Delete the run (cascade will handle files, chunks, errors)
		await db.delete(ingestionRuns).where(eq(ingestionRuns.id, input.runId));

		return {
			success: true,
			message: `Deleted run ${input.runId}`,
		};
	});

export const deleteRuns = procedure
	.input(z.object({ runIds: z.array(z.string()) }))
	.handler(async ({ input }) => {
		const db = getDb();

		if (input.runIds.length === 0) {
			return { success: true, deleted: 0, message: "No runs to delete" };
		}

		// Delete all specified runs
		let deleted = 0;
		for (const runId of input.runIds) {
			const result = await db
				.delete(ingestionRuns)
				.where(eq(ingestionRuns.id, runId));
			if (result.meta.changes > 0) {
				deleted++;
			}
		}

		return {
			success: true,
			deleted,
			message: `Deleted ${deleted} run(s)`,
		};
	});

// ============================================================================
// Manual Trigger Endpoint
// ============================================================================

export const triggerChain = procedure
	.input(
		z.object({
			chainSlug: z.string(),
			date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD").optional(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		// Validate chain slug
		if (!isValidChainId(input.chainSlug)) {
			throw new Error(`Invalid chain slug: ${input.chainSlug}`);
		}

		const chainConfig = CHAIN_CONFIGS[input.chainSlug];

		// Ensure the chain exists in the database (upsert from config)
		await db
			.insert(chains)
			.values({
				slug: chainConfig.id,
				name: chainConfig.name,
				website: chainConfig.baseUrl,
			})
			.onConflictDoNothing();

		// Create a new run for manual trigger
		const newRunId = generatePrefixedId("igr");
		await db.insert(ingestionRuns).values({
			id: newRunId,
			chainSlug: input.chainSlug,
			source: "manual",
			status: "pending",
			totalFiles: 0,
			processedFiles: 0,
			totalEntries: 0,
			processedEntries: 0,
			errorCount: 0,
		});

		// Enqueue discover message to start the ingestion pipeline
		const env = getEnv();
		const discoverMessage: DiscoverQueueMessage = {
			id: generatePrefixedId("msg"),
			type: "discover",
			runId: newRunId,
			chainSlug: input.chainSlug,
			targetDate: input.date,
			createdAt: new Date().toISOString(),
		};

		await env.INGESTION_QUEUE.send(discoverMessage);

		return {
			success: true,
			runId: newRunId,
			message: `Ingestion started for chain ${input.chainSlug}${input.date ? ` for date ${input.date}` : ""}`,
		};
	});
