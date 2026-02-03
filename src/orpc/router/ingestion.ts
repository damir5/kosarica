import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import * as z from "zod";
import { getDatabase } from "@/db";
import {
	ingestionChunks,
	ingestionErrors,
	ingestionFiles,
	ingestionRuns,
	ingestionStoreStats,
} from "@/db/schema";
import { scheduleTask } from "@/lib/taskqueue";
import { procedure } from "../base";

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

// Validation schemas for IDs
// CUID2 pattern: starts with a letter, followed by alphanumeric characters, typically 25 chars total
// See: https://github.com/paralleldrive/cuid2#specification
const Cuid2Schema = z
	.string()
	.min(1)
	.regex(/^[a-z0-9]+$/, "Invalid CUID2 format");

const ChainSlugSchema = z.string().min(1);
const IngestionStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
]);

function formatDate(date: Date | null | undefined): string | undefined {
	return date ? date.toISOString() : undefined;
}

function mapRun(run: typeof ingestionRuns.$inferSelect) {
	return {
		id: run.id,
		chainSlug: run.chainSlug,
		source: run.source,
		status: run.status,
		statusReason: run.statusReason ?? undefined,
		statusSeverity: run.statusSeverity ?? undefined,
		statusType: run.statusType ?? undefined,
		startedAt: formatDate(run.startedAt ?? undefined),
		completedAt: formatDate(run.completedAt ?? undefined),
		targetDate: formatDate(run.targetDate ?? undefined),
		totalFiles: run.totalFiles ?? undefined,
		processedFiles: run.processedFiles ?? undefined,
		totalEntries: run.totalEntries ?? undefined,
		processedEntries: run.processedEntries ?? undefined,
		errorCount: run.errorCount ?? undefined,
		metadata: run.metadata ?? undefined,
		createdAt: formatDate(run.createdAt ?? undefined),
	};
}

function mapFile(
	file: typeof ingestionFiles.$inferSelect,
	stats?: {
		storeCount?: number;
		rowCount?: number;
		persistedCount?: number;
		priceChanges?: number;
		failedRows?: number;
		warningRows?: number;
	},
) {
	return {
		id: file.id.toString(),
		runId: file.runId,
		filename: file.filename,
		fileType: file.fileType,
		fileSize: file.fileSize ?? undefined,
		fileHash: file.fileHash ?? undefined,
		status: file.status,
		statusReason: file.statusReason ?? undefined,
		statusSeverity: file.statusSeverity ?? undefined,
		statusType: file.statusType ?? undefined,
		entryCount: file.entryCount ?? undefined,
		rowCount: stats?.rowCount ?? undefined,
		persistedCount: stats?.persistedCount ?? undefined,
		priceChanges: stats?.priceChanges ?? undefined,
		failedRows: stats?.failedRows ?? undefined,
		warningRows: stats?.warningRows ?? undefined,
		storeCount: stats?.storeCount ?? undefined,
		processedAt: formatDate(file.processedAt ?? undefined),
		metadata: file.metadata ?? undefined,
		totalChunks: file.totalChunks ?? undefined,
		processedChunks: file.processedChunks ?? undefined,
		chunkSize: file.chunkSize ?? undefined,
		createdAt: formatDate(file.createdAt ?? undefined),
	};
}

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
		const db = getDatabase();
		const conditions = [];
		if (input.chainSlug) {
			conditions.push(eq(ingestionRuns.chainSlug, input.chainSlug));
		}
		if (input.status) {
			conditions.push(eq(ingestionRuns.status, input.status));
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined;

		const runsQuery = db
			.select()
			.from(ingestionRuns)
			.orderBy(desc(ingestionRuns.createdAt))
			.limit(input.limit ?? 20)
			.offset(input.offset ?? 0);

		if (where) {
			runsQuery.where(where);
		}

		const runs = await runsQuery;

		const countQuery = db
			.select({ count: sql<number>`count(*)` })
			.from(ingestionRuns);
		if (where) {
			countQuery.where(where);
		}
		const [{ count }] = await countQuery;

		return {
			runs: runs.map(mapRun),
			total: Number(count ?? 0),
		};
	});

export const getRun = procedure
	.input(z.object({ runId: Cuid2Schema }))
	.handler(async ({ input }) => {
		const db = getDatabase();
		const [run] = await db
			.select()
			.from(ingestionRuns)
			.where(eq(ingestionRuns.id, input.runId))
			.limit(1);

		if (!run) {
			throw new Error(`Run not found: ${input.runId}`);
		}

		return mapRun(run);
	});

export const listFiles = procedure
	.input(
		z.object({
			runId: Cuid2Schema,
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDatabase();
		const files = await db
			.select()
			.from(ingestionFiles)
			.where(eq(ingestionFiles.runId, input.runId))
			.orderBy(asc(ingestionFiles.createdAt))
			.limit(input.limit)
			.offset(input.offset);

		const [{ count }] = await db
			.select({ count: sql<number>`count(*)` })
			.from(ingestionFiles)
			.where(eq(ingestionFiles.runId, input.runId));

		const fileIds = files.map((file) => file.id);
		const statsByFile = new Map<
			bigint,
			{
				storeCount: number;
				rowCount: number;
				persistedCount: number;
				priceChanges: number;
				failedRows: number;
				warningRows: number;
			}
		>();

		if (fileIds.length > 0) {
			const stats = await db
				.select()
				.from(ingestionStoreStats)
				.where(inArray(ingestionStoreStats.fileId, fileIds));

			for (const stat of stats) {
				const key = stat.fileId;
				const existing = statsByFile.get(key) ?? {
					storeCount: 0,
					rowCount: 0,
					persistedCount: 0,
					priceChanges: 0,
					failedRows: 0,
					warningRows: 0,
				};
				existing.storeCount += 1;
				existing.rowCount += stat.rowCount ?? 0;
				existing.persistedCount += stat.persistedCount ?? 0;
				existing.priceChanges += stat.priceChanges ?? 0;
				existing.failedRows += stat.failedRows ?? 0;
				existing.warningRows += stat.warningRows ?? 0;
				statsByFile.set(key, existing);
			}
		}

		return {
			files: files.map((file) => mapFile(file, statsByFile.get(file.id))),
			total: Number(count ?? 0),
		};
	});

export const listErrors = procedure
	.input(
		z.object({
			runId: Cuid2Schema,
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDatabase();
		const errors = await db
			.select()
			.from(ingestionErrors)
			.where(eq(ingestionErrors.runId, input.runId))
			.orderBy(desc(ingestionErrors.createdAt))
			.limit(input.limit)
			.offset(input.offset);

		const [{ count }] = await db
			.select({ count: sql<number>`count(*)` })
			.from(ingestionErrors)
			.where(eq(ingestionErrors.runId, input.runId));

		return {
			errors: errors.map((error) => ({
				id: error.id?.toString(),
				runId: error.runId,
				fileId: error.fileId?.toString(),
				chunkId: error.chunkId ?? undefined,
				entryId: error.entryId ?? undefined,
				errorType: error.errorType,
				errorMessage: error.errorMessage,
				errorDetails: error.errorDetails ?? undefined,
				severity: error.severity ?? undefined,
				createdAt: formatDate(error.createdAt ?? undefined),
			})),
			total: Number(count ?? 0),
		};
	});

export const listRunStoreStats = procedure
	.input(
		z.object({
			runId: Cuid2Schema,
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDatabase();
		const result = await db.execute(sql`
			SELECT
				stats.store_id AS "storeId",
				stats.store_identifier AS "storeIdentifier",
				st.name AS "storeName",
				st.city AS "storeCity",
				SUM(stats.row_count)::int AS "rowCount",
				SUM(stats.persisted_count)::int AS "persistedCount",
				SUM(stats.price_changes)::int AS "priceChanges",
				SUM(stats.failed_rows)::int AS "failedRows",
				SUM(stats.warning_rows)::int AS "warningRows",
				COUNT(DISTINCT stats.file_id)::int AS "fileCount"
			FROM ingestion_store_stats stats
			JOIN stores st ON st.id = stats.store_id
			WHERE stats.run_id = ${input.runId}
			GROUP BY stats.store_id, stats.store_identifier, st.name, st.city
			ORDER BY SUM(stats.row_count) DESC
			LIMIT ${input.limit} OFFSET ${input.offset}
		`);

		const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
			storeId: string;
			storeIdentifier: string;
			storeName: string | null;
			storeCity: string | null;
			rowCount: number;
			persistedCount: number;
			priceChanges: number;
			failedRows: number;
			warningRows: number;
			fileCount: number;
		}>;

		const countResult = await db.execute(sql`
			SELECT COUNT(DISTINCT store_id)::int AS count
			FROM ingestion_store_stats
			WHERE run_id = ${input.runId}
		`);
		const countRows = ((countResult as { rows?: unknown[] }).rows ??
			[]) as Array<{
			count: number;
		}>;
		const total = Number(countRows[0]?.count ?? 0);

		return {
			stores: rows.map((row) => ({
				storeId: row.storeId,
				storeIdentifier: row.storeIdentifier,
				storeName: row.storeName ?? undefined,
				storeCity: row.storeCity ?? undefined,
				rowCount: row.rowCount,
				persistedCount: row.persistedCount,
				priceChanges: row.priceChanges,
				failedRows: row.failedRows,
				warningRows: row.warningRows,
				fileCount: row.fileCount,
			})),
			total,
		};
	});

export const getStats = procedure
	.input(
		z
			.object({
				timeRange: z.enum(["24h", "7d", "30d"]).default("24h"),
			})
			.optional(),
	)
	.handler(async ({ input = {} }): Promise<IngestionStats> => {
		const db = getDatabase();
		const timeRange = input.timeRange ?? "24h";
		const now = new Date();
		const from = new Date(now.getTime() - TIME_RANGE_MS[timeRange]);

		const [runCounts] = await db
			.select({
				total: sql<number>`count(*)`,
				pending: sql<number>`count(*) filter (where status = 'pending')`,
				running: sql<number>`count(*) filter (where status = 'running')`,
				completed: sql<number>`count(*) filter (where status = 'completed')`,
				failed: sql<number>`count(*) filter (where status = 'failed')`,
				totalEntries: sql<number>`coalesce(sum(total_entries), 0)`,
				processedEntries: sql<number>`coalesce(sum(processed_entries), 0)`,
			})
			.from(ingestionRuns)
			.where(
				and(
					gte(ingestionRuns.createdAt, from),
					lte(ingestionRuns.createdAt, now),
				),
			);

		const [fileCounts] = await db
			.select({
				total: sql<number>`count(*)`,
				processed: sql<number>`count(*) filter (where status = 'completed')`,
			})
			.from(ingestionFiles)
			.where(
				and(
					gte(ingestionFiles.createdAt, from),
					lte(ingestionFiles.createdAt, now),
				),
			);

		const [errorCounts] = await db
			.select({
				total: sql<number>`count(*)`,
			})
			.from(ingestionErrors)
			.where(
				and(
					gte(ingestionErrors.createdAt, from),
					lte(ingestionErrors.createdAt, now),
				),
			);

		return {
			timeRange,
			runs: {
				total: Number(runCounts?.total ?? 0),
				pending: Number(runCounts?.pending ?? 0),
				running: Number(runCounts?.running ?? 0),
				completed: Number(runCounts?.completed ?? 0),
				failed: Number(runCounts?.failed ?? 0),
			},
			files: {
				total: Number(fileCounts?.total ?? 0),
				processed: Number(fileCounts?.processed ?? 0),
			},
			entries: {
				total: Number(runCounts?.totalEntries ?? 0),
				processed: Number(runCounts?.processedEntries ?? 0),
			},
			errors: {
				total: Number(errorCounts?.total ?? 0),
				byType: {},
				bySeverity: {},
			},
		};
	});

export const triggerChain = procedure
	.input(
		z.object({
			chain: ChainSlugSchema,
			targetDate: z.string().optional(),
			priority: z.number().optional().default(0),
			force: z.boolean().optional().default(false),
		}),
	)
	.handler(async ({ input }) => {
		const now = new Date();
		const targetDate =
			input.targetDate ??
			[
				now.getFullYear(),
				String(now.getMonth() + 1).padStart(2, "0"),
				String(now.getDate()).padStart(2, "0"),
			].join("-");

		await scheduleTask({
			taskType: "ingestion",
			priority: input.priority ?? 0,
			payload: {
				type: "ingestion",
				chainSlug: input.chain,
				targetDate,
				force: input.force,
				source: "manual",
			},
		});

		return {
			status: "scheduled",
			message: "Ingestion task scheduled",
		};
	});

export const rerunRun = procedure
	.input(
		z.object({
			runId: Cuid2Schema,
			rerunType: z.enum(["file", "chunk", "entry"]).default("file"),
			targetId: z.string().min(1), // Can be fileId or chunkId
		}),
	)
	.handler(async ({ input }) => {
		await scheduleTask({
			taskType: "rerun",
			payload: {
				type: "rerun",
				originalRunId: input.runId,
				rerunType: input.rerunType,
				targetId: input.targetId,
			},
		});

		return {
			status: "scheduled",
		};
	});

export const deleteRun = procedure
	.input(z.object({ runId: Cuid2Schema }))
	.handler(async ({ input }) => {
		const db = getDatabase();
		await db.delete(ingestionRuns).where(eq(ingestionRuns.id, input.runId));
		return { status: "deleted" };
	});

export const getFile = procedure
	.input(
		z.object({
			fileId: z
				.string()
				.regex(/^\d+$/, "File ID must be a numeric string")
				.transform((v) => BigInt(v)),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDatabase();
		const fileId = input.fileId;
		const [file] = await db
			.select()
			.from(ingestionFiles)
			.where(eq(ingestionFiles.id, fileId))
			.limit(1);

		if (!file) {
			throw new Error(`File not found: ${input.fileId}`);
		}

		const stats = await db
			.select()
			.from(ingestionStoreStats)
			.where(eq(ingestionStoreStats.fileId, fileId));

		const aggregates = stats.reduce(
			(acc, stat) => {
				acc.storeCount += 1;
				acc.rowCount += stat.rowCount ?? 0;
				acc.persistedCount += stat.persistedCount ?? 0;
				acc.priceChanges += stat.priceChanges ?? 0;
				acc.failedRows += stat.failedRows ?? 0;
				acc.warningRows += stat.warningRows ?? 0;
				return acc;
			},
			{
				storeCount: 0,
				rowCount: 0,
				persistedCount: 0,
				priceChanges: 0,
				failedRows: 0,
				warningRows: 0,
			},
		);

		return mapFile(file, aggregates);
	});

export const listChunks = procedure
	.input(
		z.object({
			fileId: z
				.string()
				.regex(/^\d+$/, "File ID must be a numeric string")
				.transform((v) => BigInt(v)),
			status: z
				.enum(["pending", "processing", "completed", "failed"])
				.optional(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDatabase();
		const fileId = input.fileId;
		const offset = (input.page - 1) * input.pageSize;
		const conditions = [eq(ingestionChunks.fileId, fileId)];

		if (input.status) {
			conditions.push(eq(ingestionChunks.status, input.status));
		}

		const chunks = await db
			.select()
			.from(ingestionChunks)
			.where(and(...conditions))
			.orderBy(asc(ingestionChunks.chunkIndex))
			.limit(input.pageSize)
			.offset(offset);

		const [{ count }] = await db
			.select({ count: sql<number>`count(*)` })
			.from(ingestionChunks)
			.where(and(...conditions));

		const total = Number(count ?? 0);
		const totalPages = Math.ceil(total / input.pageSize);

		return {
			chunks: chunks.map((chunk) => ({
				id: chunk.id,
				fileId: chunk.fileId?.toString(),
				chunkIndex: chunk.chunkIndex,
				startRow: chunk.startRow,
				endRow: chunk.endRow,
				rowCount: chunk.rowCount,
				status: chunk.status,
				r2Key: chunk.r2Key ?? undefined,
				persistedCount: chunk.persistedCount ?? undefined,
				errorCount: chunk.errorCount ?? undefined,
				processedAt: formatDate(chunk.processedAt ?? undefined),
				createdAt: formatDate(chunk.createdAt ?? undefined),
			})),
			total,
			totalPages,
		};
	});

export const rerunFile = procedure
	.input(
		z.object({
			fileId: z
				.string()
				.regex(/^\d+$/, "File ID must be a numeric string")
				.transform((v) => BigInt(v)),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDatabase();
		const fileId = input.fileId;
		const [file] = await db
			.select({ runId: ingestionFiles.runId })
			.from(ingestionFiles)
			.where(eq(ingestionFiles.id, fileId))
			.limit(1);

		if (!file) {
			throw new Error(`File not found: ${input.fileId}`);
		}

		await scheduleTask({
			taskType: "rerun",
			payload: {
				type: "rerun",
				originalRunId: file.runId,
				rerunType: "file",
				targetId: input.fileId.toString(),
			},
		});

		return { status: "scheduled" };
	});

export const rerunChunk = procedure
	.input(z.object({ chunkId: Cuid2Schema }))
	.handler(async ({ input }) => {
		const db = getDatabase();
		const [chunk] = await db
			.select({
				fileId: ingestionChunks.fileId,
			})
			.from(ingestionChunks)
			.where(eq(ingestionChunks.id, input.chunkId))
			.limit(1);

		if (!chunk?.fileId) {
			throw new Error(`Chunk not found: ${input.chunkId}`);
		}

		const [file] = await db
			.select({ runId: ingestionFiles.runId })
			.from(ingestionFiles)
			.where(eq(ingestionFiles.id, chunk.fileId))
			.limit(1);

		if (!file) {
			throw new Error(`Run not found for chunk: ${input.chunkId}`);
		}

		await scheduleTask({
			taskType: "rerun",
			payload: {
				type: "rerun",
				originalRunId: file.runId,
				rerunType: "chunk",
				targetId: input.chunkId,
			},
		});

		return { status: "scheduled" };
	});

export const listFileErrors = procedure
	.input(
		z.object({
			fileId: z
				.string()
				.regex(/^\d+$/, "File ID must be a numeric string")
				.transform((v) => BigInt(v)),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(10),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDatabase();
		const fileId = input.fileId;
		const offset = (input.page - 1) * input.pageSize;

		const errors = await db
			.select()
			.from(ingestionErrors)
			.where(eq(ingestionErrors.fileId, fileId))
			.orderBy(desc(ingestionErrors.createdAt))
			.limit(input.pageSize)
			.offset(offset);

		const [{ count }] = await db
			.select({ count: sql<number>`count(*)` })
			.from(ingestionErrors)
			.where(eq(ingestionErrors.fileId, fileId));

		return {
			errors: errors.map((error) => ({
				id: error.id?.toString(),
				chunkId: error.chunkId ?? undefined,
				errorType: error.errorType,
				errorMessage: error.errorMessage,
				errorDetails: error.errorDetails ?? undefined,
				severity: error.severity ?? undefined,
				createdAt: formatDate(error.createdAt ?? undefined),
			})),
			total: Number(count ?? 0),
		};
	});

export const listFileStoreStats = procedure
	.input(
		z.object({
			fileId: z
				.string()
				.regex(/^\d+$/, "File ID must be a numeric string")
				.transform((v) => BigInt(v)),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDatabase();
		const fileId = input.fileId;
		const result = await db.execute(sql`
			SELECT
				stats.store_id AS "storeId",
				stats.store_identifier AS "storeIdentifier",
				st.name AS "storeName",
				st.city AS "storeCity",
				stats.row_count AS "rowCount",
				stats.persisted_count AS "persistedCount",
				stats.price_changes AS "priceChanges",
				stats.failed_rows AS "failedRows",
				stats.warning_rows AS "warningRows",
				1 AS "fileCount"
			FROM ingestion_store_stats stats
			JOIN stores st ON st.id = stats.store_id
			WHERE stats.file_id = ${fileId}
			ORDER BY stats.row_count DESC
			LIMIT ${input.limit} OFFSET ${input.offset}
		`);

		const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
			storeId: string;
			storeIdentifier: string;
			storeName: string | null;
			storeCity: string | null;
			rowCount: number;
			persistedCount: number;
			priceChanges: number;
			failedRows: number;
			warningRows: number;
			fileCount: number;
		}>;

		const countResult = await db.execute(sql`
			SELECT COUNT(*)::int AS count
			FROM ingestion_store_stats
			WHERE file_id = ${fileId}
		`);
		const countRows = ((countResult as { rows?: unknown[] }).rows ??
			[]) as Array<{
			count: number;
		}>;
		const total = Number(countRows[0]?.count ?? 0);

		return {
			stores: rows.map((row) => ({
				storeId: row.storeId,
				storeIdentifier: row.storeIdentifier,
				storeName: row.storeName ?? undefined,
				storeCity: row.storeCity ?? undefined,
				rowCount: row.rowCount,
				persistedCount: row.persistedCount,
				priceChanges: row.priceChanges,
				failedRows: row.failedRows,
				warningRows: row.warningRows,
				fileCount: row.fileCount,
			})),
			total,
		};
	});
