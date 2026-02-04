import { and, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import {
	activeIngestionOperations,
	archives,
	ingestionErrors,
	ingestionFiles,
	ingestionRuns,
	ingestionStoreStats,
	parquetFiles,
	retailerItemBarcodes,
	retailerItems,
	retailerItemsFailed,
	storeIdentifiers,
	stores,
} from "@/db/schema";
import { getChainConfig } from "@/ingestion/adapters/config";
import { getAdapter } from "@/ingestion/adapters/registry";
import type { ChainAdapter } from "@/ingestion/adapters/types";
import { type ParquetPriceRow, writePricesParquet } from "@/ingestion/parquet";
import type {
	DiscoveredFile,
	NormalizedRow,
	ParseResult,
	PriceUnavailableReason,
} from "@/ingestion/types";
import {
	buildArchiveKey,
	buildExpandedKey,
	buildParquetKey,
	buildTempExpandedKey,
	cleanupTempDirs,
	createTempDir,
	deleteTempDir,
	formatTimestamp,
	getStorage,
} from "@/lib/storage";
import { generatePrefixedId } from "@/utils/id";
import { createLogger, errorToObject } from "@/utils/logger";

export interface IngestionOptions {
	chainSlug: string;
	targetDate?: string;
	source?: string;
	force?: boolean;
	parentRunId?: string;
	rerunType?: string;
	rerunTargetId?: string;
	taskId?: string;
}

export interface IngestionResult {
	runId: string;
	status: "completed" | "failed" | "skipped";
	message?: string;
}

const log = createLogger("ingestion");

interface IngestionPerformanceConfig {
	fileConcurrency: number;
	dbBatchSize: number;
	progressUpdateIntervalMs: number;
	itemWriteShards: number;
	itemWriteBatchSize: number;
	itemWriteRetryMax: number;
	itemWriteRetryBaseMs: number;
}

interface ValidRowForPersistence {
	row: NormalizedRow;
	storeId: string;
	storeIdentifier: string;
	hasWarning: boolean;
}

interface ProcessedFileResult {
	totalRows: number;
	processedRows: number;
	warningRows: number;
	failedRows: number;
	errorCount: number;
	parquetRows: ParquetPriceRow[];
	itemResolveMs: number;
	itemInsertMs: number;
	itemMetadataUpdateMs: number;
	barcodeInsertMs: number;
	deadlockRetries: number;
	priceAvailability: PriceAvailabilityStats;
}

interface FileToProcess {
	file: DiscoveredFile;
	content: Buffer;
	type: string;
	filename: string;
	hash: string;
	archiveId: string;
	expandedFrom?: string;
	tempStorageKey?: string;
}

interface ItemPersistenceState {
	cacheByExternalId: Map<string, string>;
	cacheByBarcode: Map<string, string>;
	updatedItemIds: Set<string>;
	knownItemBarcodePairs: Set<string>;
	batchSize: number;
}

interface ItemPersistenceResult {
	itemIds: string[];
	itemInsertMs: number;
	itemMetadataUpdateMs: number;
	barcodeInsertMs: number;
}

interface DeadlockRetryOptions {
	maxAttempts: number;
	baseBackoffMs: number;
	onRetry?: () => void;
}

interface ItemWriteSharder {
	shardCount: number;
	shardForKey: (key: string) => number;
	enqueueShard: <T>(
		shardIndex: number,
		operation: () => Promise<T>,
	) => Promise<T>;
}

interface PriceAvailabilityStats {
	availableRows: number;
	unavailableRows: number;
	unavailableMissingRows: number;
	unavailableInvalidRows: number;
	unavailableNonPositiveRows: number;
}

function emptyPriceAvailabilityStats(): PriceAvailabilityStats {
	return {
		availableRows: 0,
		unavailableRows: 0,
		unavailableMissingRows: 0,
		unavailableInvalidRows: 0,
		unavailableNonPositiveRows: 0,
	};
}

function trackUnavailableReason(
	stats: PriceAvailabilityStats,
	reason: PriceUnavailableReason | undefined,
): void {
	switch (reason) {
		case "invalid":
			stats.unavailableInvalidRows += 1;
			return;
		case "non_positive":
			stats.unavailableNonPositiveRows += 1;
			return;
		case "missing":
		default:
			stats.unavailableMissingRows += 1;
	}
}

function parsePositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		log.warn("Invalid ingestion performance setting, using fallback", {
			name,
			value: raw,
			fallback,
		});
		return fallback;
	}
	return parsed;
}

function getIngestionPerformanceConfig(): IngestionPerformanceConfig {
	return {
		fileConcurrency: parsePositiveIntEnv("INGESTION_FILE_CONCURRENCY", 3),
		dbBatchSize: parsePositiveIntEnv("INGESTION_DB_BATCH_SIZE", 1000),
		progressUpdateIntervalMs: parsePositiveIntEnv(
			"INGESTION_PROGRESS_UPDATE_INTERVAL_MS",
			5000,
		),
		itemWriteShards: parsePositiveIntEnv("INGESTION_ITEM_WRITE_SHARDS", 2),
		itemWriteBatchSize: parsePositiveIntEnv(
			"INGESTION_ITEM_WRITE_BATCH_SIZE",
			500,
		),
		itemWriteRetryMax: parsePositiveIntEnv("INGESTION_ITEM_WRITE_RETRY_MAX", 5),
		itemWriteRetryBaseMs: parsePositiveIntEnv(
			"INGESTION_ITEM_WRITE_RETRY_BASE_MS",
			50,
		),
	};
}

function chunkArray<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
	if (items.length === 0) {
		return;
	}

	const maxWorkers = Math.max(1, Math.min(concurrency, items.length));
	let nextIndex = 0;
	let firstError: unknown = null;

	const workers = Array.from({ length: maxWorkers }, async () => {
		while (true) {
			if (firstError) {
				return;
			}
			const currentIndex = nextIndex;
			nextIndex += 1;
			if (currentIndex >= items.length) {
				return;
			}

			try {
				await handler(items[currentIndex], currentIndex);
			} catch (error) {
				if (!firstError) {
					firstError = error;
				}
				return;
			}
		}
	});

	await Promise.allSettled(workers);

	if (firstError) {
		throw firstError;
	}
}

function hashString(input: string): number {
	let hash = 0;
	for (let i = 0; i < input.length; i += 1) {
		hash = (hash << 5) - hash + input.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

function createItemWriteSharder(shardCount: number): ItemWriteSharder {
	const normalizedShardCount = Math.max(1, shardCount);
	const shardQueues = Array.from({ length: normalizedShardCount }, () =>
		Promise.resolve(),
	);

	const enqueueShard = async <T>(
		shardIndex: number,
		operation: () => Promise<T>,
	): Promise<T> => {
		const safeShardIndex = Math.max(
			0,
			Math.min(normalizedShardCount - 1, shardIndex),
		);
		const previous = shardQueues[safeShardIndex];
		let releaseCurrent: (() => void) | null = null;
		shardQueues[safeShardIndex] = new Promise<void>((resolve) => {
			releaseCurrent = resolve;
		});

		await previous;
		try {
			return await operation();
		} finally {
			releaseCurrent?.();
		}
	};

	return {
		shardCount: normalizedShardCount,
		shardForKey: (key: string) => hashString(key) % normalizedShardCount,
		enqueueShard,
	};
}

function isDeadlockError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}

	const directCode =
		"code" in error && typeof error.code === "string" ? error.code : undefined;
	if (directCode === "40P01") {
		return true;
	}

	if (!("cause" in error) || !error.cause || typeof error.cause !== "object") {
		return false;
	}

	const causeCode =
		"code" in error.cause && typeof error.cause.code === "string"
			? error.cause.code
			: undefined;
	return causeCode === "40P01";
}

async function withDeadlockRetry<T>(
	operationName: string,
	operation: () => Promise<T>,
	options?: Partial<DeadlockRetryOptions>,
): Promise<T> {
	const maxAttempts = options?.maxAttempts ?? 3;
	const baseBackoffMs = options?.baseBackoffMs ?? 100;
	const onRetry = options?.onRetry;

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (!isDeadlockError(error) || attempt === maxAttempts) {
				throw error;
			}

			onRetry?.();
			const backoffMs = baseBackoffMs * 2 ** (attempt - 1);
			log.warn("Deadlock detected, retrying operation", {
				operation: operationName,
				attempt,
				maxAttempts,
				backoffMs,
			});
			await new Promise((resolve) => setTimeout(resolve, backoffMs));
		}
	}

	throw lastError;
}

function formatDateLocal(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function parseTargetDate(input?: string): { date: Date; dateStr: string } {
	const today = new Date();
	if (!input) {
		const dateStr = formatDateLocal(today);
		const date = new Date(
			today.getFullYear(),
			today.getMonth(),
			today.getDate(),
		);
		return { date, dateStr };
	}

	const parts = input.split("-").map((part) => Number(part));
	if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
		throw new Error(`invalid targetDate: ${input}`);
	}
	const [year, month, day] = parts;
	const date = new Date(year, month - 1, day);
	return { date, dateStr: input };
}

function buildStoreIdentifierType(chainSlug: string): string {
	const config = getChainConfig(chainSlug as never);
	switch (config.storeResolution) {
		case "portal_id":
			return "portal_id";
		case "national":
			return "national";
		default:
			return "filename_code";
	}
}

async function resolveStoreId(
	chainSlug: string,
	storeIdentifier: string,
	storeIdentifierType: string,
	metadata: {
		name?: string;
		address?: string;
		city?: string;
		postalCode?: string;
	} | null,
	cache: Map<string, string>,
	inFlightResolutions?: Map<string, Promise<string>>,
): Promise<string> {
	const cacheKey = `${chainSlug}:${storeIdentifier}`;
	const cached = cache.get(cacheKey);
	if (cached) {
		return cached;
	}

	if (inFlightResolutions) {
		const inFlight = inFlightResolutions.get(cacheKey);
		if (inFlight) {
			return inFlight;
		}
	}

	const resolver = (async () => {
		const db = getDatabase();
		const existing = await db
			.select({ id: stores.id })
			.from(storeIdentifiers)
			.innerJoin(stores, eq(stores.id, storeIdentifiers.storeId))
			.where(
				and(
					eq(storeIdentifiers.value, storeIdentifier),
					eq(stores.chainSlug, chainSlug),
				),
			)
			.limit(1);

		if (existing[0]) {
			cache.set(cacheKey, existing[0].id);
			return existing[0].id;
		}

		const storeId = generatePrefixedId("sto");
		const storeName =
			metadata?.name ||
			`${chainSlug.toUpperCase()} ${storeIdentifier}`.slice(0, 255);

		await db.insert(stores).values({
			id: storeId,
			chainSlug,
			name: storeName,
			address: metadata?.address,
			city: metadata?.city,
			postalCode: metadata?.postalCode,
			isVirtual: true,
			status: "pending",
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await db.insert(storeIdentifiers).values({
			id: generatePrefixedId("sid"),
			storeId,
			type: storeIdentifierType,
			value: storeIdentifier,
			createdAt: new Date(),
		});

		cache.set(cacheKey, storeId);
		return storeId;
	})();

	if (inFlightResolutions) {
		inFlightResolutions.set(cacheKey, resolver);
	}

	try {
		return await resolver;
	} finally {
		inFlightResolutions?.delete(cacheKey);
	}
}

function externalIdCacheKey(chainSlug: string, externalId: string): string {
	return `${chainSlug}:external:${externalId}`;
}

function barcodeCacheKey(chainSlug: string, barcode: string): string {
	return `${chainSlug}:barcode:${barcode}`;
}

function normalizeExternalId(externalId?: string): string | null {
	if (!externalId) {
		return null;
	}
	const normalized = externalId.trim();
	return normalized.length > 0 ? normalized : null;
}

async function loadItemsByExternalIds(
	chainSlug: string,
	externalIds: string[],
	batchSize: number,
): Promise<Map<string, string>> {
	const matches = new Map<string, string>();
	if (externalIds.length === 0) {
		return matches;
	}

	const db = getDatabase();
	for (const chunk of chunkArray(externalIds, batchSize)) {
		const rows = await db
			.select({ id: retailerItems.id, externalId: retailerItems.externalId })
			.from(retailerItems)
			.where(
				and(
					eq(retailerItems.chainSlug, chainSlug),
					inArray(retailerItems.externalId, chunk),
				),
			);
		for (const row of rows) {
			if (row.externalId) {
				matches.set(row.externalId, row.id);
			}
		}
	}

	return matches;
}

async function loadItemsByBarcodes(
	chainSlug: string,
	barcodes: string[],
	batchSize: number,
): Promise<Map<string, string>> {
	const matches = new Map<string, string>();
	if (barcodes.length === 0) {
		return matches;
	}

	const db = getDatabase();
	for (const chunk of chunkArray(barcodes, batchSize)) {
		const rows = await db
			.select({
				barcode: retailerItemBarcodes.barcode,
				itemId: retailerItems.id,
			})
			.from(retailerItemBarcodes)
			.innerJoin(
				retailerItems,
				eq(retailerItems.id, retailerItemBarcodes.retailerItemId),
			)
			.where(
				and(
					eq(retailerItems.chainSlug, chainSlug),
					inArray(retailerItemBarcodes.barcode, chunk),
				),
			);
		for (const row of rows) {
			if (!matches.has(row.barcode)) {
				matches.set(row.barcode, row.itemId);
			}
		}
	}

	return matches;
}

async function updateRetailerItemMetadataBatch(
	updates: Array<{ itemId: string; row: NormalizedRow }>,
	archiveId: string | null,
): Promise<void> {
	if (updates.length === 0) {
		return;
	}

	const values = sql.join(
		updates.map(
			(update) =>
				sql`(${update.itemId}, ${update.row.name}, ${update.row.description ?? null}, ${update.row.category ?? null}, ${update.row.subcategory ?? null}, ${update.row.brand ?? null}, ${update.row.unit ?? null}, ${update.row.unitQuantity ?? null}, ${update.row.imageUrl ?? null}, ${archiveId})`,
		),
		sql`, `,
	);

	await getDatabase().execute(sql`
		update retailer_items as ri
		set
			name = src.name,
			description = src.description,
			category = src.category,
			subcategory = src.subcategory,
			brand = src.brand,
			unit = src.unit,
			unit_quantity = src.unit_quantity,
			image_url = src.image_url,
			archive_id = coalesce(src.archive_id, ri.archive_id)
		from (values ${values}) as src (
			id,
			name,
			description,
			category,
			subcategory,
			brand,
			unit,
			unit_quantity,
			image_url,
			archive_id
		)
		where ri.id = src.id
	`);
}

function buildNewItemCandidateKey(
	externalId: string | null,
	barcodes: string[],
	rowIndex: number,
): string {
	if (externalId) {
		return `external:${externalId}`;
	}
	const firstBarcode = barcodes[0];
	if (firstBarcode) {
		return `barcode:${firstBarcode}`;
	}
	return `row:${rowIndex}`;
}

function buildItemWriteKey(
	rowEntry: ValidRowForPersistence,
	rowIndex: number,
): string {
	const externalId = normalizeExternalId(rowEntry.row.externalId);
	if (externalId) {
		return `external:${externalId}`;
	}
	const firstBarcode = rowEntry.row.barcodes[0];
	if (firstBarcode) {
		return `barcode:${firstBarcode}`;
	}
	return `fallback:${rowEntry.storeIdentifier}:${rowEntry.row.rowNumber ?? rowIndex}`;
}

async function resolveRetailerItemsForRows(
	chainSlug: string,
	rows: ValidRowForPersistence[],
	archiveId: string | null,
	state: ItemPersistenceState,
): Promise<ItemPersistenceResult> {
	if (rows.length === 0) {
		return {
			itemIds: [],
			itemInsertMs: 0,
			itemMetadataUpdateMs: 0,
			barcodeInsertMs: 0,
		};
	}

	const db = getDatabase();
	let itemInsertMs = 0;
	let itemMetadataUpdateMs = 0;
	let barcodeInsertMs = 0;

	const knownExternalIds = new Map<string, string>();
	const missingExternalIds = new Set<string>();
	for (const rowEntry of rows) {
		const externalId = normalizeExternalId(rowEntry.row.externalId);
		if (!externalId) {
			continue;
		}
		const cached = state.cacheByExternalId.get(
			externalIdCacheKey(chainSlug, externalId),
		);
		if (cached) {
			knownExternalIds.set(externalId, cached);
		} else {
			missingExternalIds.add(externalId);
		}
	}

	const loadedExternalIds = await loadItemsByExternalIds(
		chainSlug,
		Array.from(missingExternalIds),
		state.batchSize,
	);
	for (const [externalId, itemId] of loadedExternalIds) {
		knownExternalIds.set(externalId, itemId);
		state.cacheByExternalId.set(
			externalIdCacheKey(chainSlug, externalId),
			itemId,
		);
	}

	const knownBarcodes = new Map<string, string>();
	const missingBarcodes = new Set<string>();
	for (const rowEntry of rows) {
		const externalId = normalizeExternalId(rowEntry.row.externalId);
		if (externalId) {
			continue;
		}
		for (const barcode of rowEntry.row.barcodes) {
			const cached = state.cacheByBarcode.get(
				barcodeCacheKey(chainSlug, barcode),
			);
			if (cached) {
				knownBarcodes.set(barcode, cached);
			} else {
				missingBarcodes.add(barcode);
			}
		}
	}

	const loadedBarcodes = await loadItemsByBarcodes(
		chainSlug,
		Array.from(missingBarcodes),
		state.batchSize,
	);
	for (const [barcode, itemId] of loadedBarcodes) {
		knownBarcodes.set(barcode, itemId);
		state.cacheByBarcode.set(barcodeCacheKey(chainSlug, barcode), itemId);
	}

	type NewItemCandidate = {
		provisionalId: string;
		externalId: string | null;
		row: NormalizedRow;
	};

	const rowItemIds = new Array<string>(rows.length);
	const rowExternalIds = new Array<string | null>(rows.length);
	const newCandidates = new Map<string, NewItemCandidate>();

	for (const [index, rowEntry] of rows.entries()) {
		const externalId = normalizeExternalId(rowEntry.row.externalId);
		rowExternalIds[index] = externalId;
		let resolvedItemId: string | null = null;

		if (externalId) {
			resolvedItemId = knownExternalIds.get(externalId) ?? null;
		} else {
			for (const barcode of rowEntry.row.barcodes) {
				const byBarcode = knownBarcodes.get(barcode);
				if (byBarcode) {
					resolvedItemId = byBarcode;
					break;
				}
			}
		}

		if (resolvedItemId) {
			rowItemIds[index] = resolvedItemId;
			if (externalId) {
				state.cacheByExternalId.set(
					externalIdCacheKey(chainSlug, externalId),
					resolvedItemId,
				);
			}
			for (const barcode of rowEntry.row.barcodes) {
				state.cacheByBarcode.set(
					barcodeCacheKey(chainSlug, barcode),
					resolvedItemId,
				);
			}
			continue;
		}

		const candidateKey = buildNewItemCandidateKey(
			externalId,
			rowEntry.row.barcodes,
			index,
		);
		const existingCandidate = newCandidates.get(candidateKey);
		if (existingCandidate) {
			rowItemIds[index] = existingCandidate.provisionalId;
			continue;
		}

		const candidate: NewItemCandidate = {
			provisionalId: generatePrefixedId("rit"),
			externalId,
			row: rowEntry.row,
		};
		newCandidates.set(candidateKey, candidate);
		rowItemIds[index] = candidate.provisionalId;
	}

	const createdItemIds = new Set<string>();
	const provisionalToFinal = new Map<string, string>();

	const candidatesWithExternalId = Array.from(newCandidates.values())
		.filter((candidate) => candidate.externalId !== null)
		.sort((left, right) => {
			const leftExternalId = left.externalId ?? "";
			const rightExternalId = right.externalId ?? "";
			return (
				leftExternalId.localeCompare(rightExternalId) ||
				left.provisionalId.localeCompare(right.provisionalId)
			);
		});
	const candidatesWithoutExternalId = Array.from(newCandidates.values())
		.filter((candidate) => candidate.externalId === null)
		.sort((left, right) => {
			const leftBarcode = left.row.barcodes[0] ?? "";
			const rightBarcode = right.row.barcodes[0] ?? "";
			return (
				leftBarcode.localeCompare(rightBarcode) ||
				left.provisionalId.localeCompare(right.provisionalId)
			);
		});

	for (const candidate of candidatesWithoutExternalId) {
		provisionalToFinal.set(candidate.provisionalId, candidate.provisionalId);
	}

	for (const chunk of chunkArray(
		candidatesWithoutExternalId,
		state.batchSize,
	)) {
		const insertStartedAt = Date.now();
		await db.insert(retailerItems).values(
			chunk.map((candidate) => ({
				id: candidate.provisionalId,
				name: candidate.row.name,
				externalId: null,
				description: candidate.row.description,
				category: candidate.row.category,
				subcategory: candidate.row.subcategory,
				brand: candidate.row.brand,
				unit: candidate.row.unit,
				unitQuantity: candidate.row.unitQuantity,
				imageUrl: candidate.row.imageUrl,
				barcode: candidate.row.barcodes[0] ?? null,
				chainSlug,
				archiveId,
				createdAt: new Date(),
			})),
		);
		itemInsertMs += Date.now() - insertStartedAt;
		for (const candidate of chunk) {
			createdItemIds.add(candidate.provisionalId);
			for (const barcode of candidate.row.barcodes) {
				state.cacheByBarcode.set(
					barcodeCacheKey(chainSlug, barcode),
					candidate.provisionalId,
				);
			}
		}
	}

	const insertedExternalIds = new Map<string, string>();
	for (const chunk of chunkArray(candidatesWithExternalId, state.batchSize)) {
		const insertStartedAt = Date.now();
		const insertedRows = await db
			.insert(retailerItems)
			.values(
				chunk.map((candidate) => ({
					id: candidate.provisionalId,
					name: candidate.row.name,
					externalId: candidate.externalId,
					description: candidate.row.description,
					category: candidate.row.category,
					subcategory: candidate.row.subcategory,
					brand: candidate.row.brand,
					unit: candidate.row.unit,
					unitQuantity: candidate.row.unitQuantity,
					imageUrl: candidate.row.imageUrl,
					barcode: candidate.row.barcodes[0] ?? null,
					chainSlug,
					archiveId,
					createdAt: new Date(),
				})),
			)
			.onConflictDoNothing({
				target: [retailerItems.chainSlug, retailerItems.externalId],
			})
			.returning({
				id: retailerItems.id,
				externalId: retailerItems.externalId,
			});
		itemInsertMs += Date.now() - insertStartedAt;

		for (const inserted of insertedRows) {
			if (inserted.externalId) {
				insertedExternalIds.set(inserted.externalId, inserted.id);
				createdItemIds.add(inserted.id);
			}
		}
	}

	const externalIdsToResolve = candidatesWithExternalId
		.map((candidate) => candidate.externalId)
		.filter((externalId): externalId is string => externalId !== null);
	const finalExternalIds = await loadItemsByExternalIds(
		chainSlug,
		externalIdsToResolve,
		state.batchSize,
	);

	for (const candidate of candidatesWithExternalId) {
		const externalId = candidate.externalId;
		if (!externalId) {
			continue;
		}
		const finalId =
			finalExternalIds.get(externalId) ?? insertedExternalIds.get(externalId);
		if (!finalId) {
			throw new Error(
				`Failed to resolve item id for external id ${externalId} in chain ${chainSlug}`,
			);
		}
		provisionalToFinal.set(candidate.provisionalId, finalId);
		state.cacheByExternalId.set(
			externalIdCacheKey(chainSlug, externalId),
			finalId,
		);
		for (const barcode of candidate.row.barcodes) {
			state.cacheByBarcode.set(barcodeCacheKey(chainSlug, barcode), finalId);
		}
	}

	for (let i = 0; i < rowItemIds.length; i += 1) {
		const finalId = provisionalToFinal.get(rowItemIds[i]);
		if (finalId) {
			rowItemIds[i] = finalId;
		}
	}

	const metadataUpdates: Array<{ itemId: string; row: NormalizedRow }> = [];
	const metadataQueuedInBatch = new Set<string>();

	for (let i = 0; i < rows.length; i += 1) {
		const itemId = rowItemIds[i];
		const externalId = rowExternalIds[i];
		if (!externalId || createdItemIds.has(itemId)) {
			continue;
		}
		if (state.updatedItemIds.has(itemId) || metadataQueuedInBatch.has(itemId)) {
			continue;
		}
		state.updatedItemIds.add(itemId);
		metadataQueuedInBatch.add(itemId);
		metadataUpdates.push({ itemId, row: rows[i].row });
	}

	for (const chunk of chunkArray(metadataUpdates, state.batchSize)) {
		const metadataStartedAt = Date.now();
		await updateRetailerItemMetadataBatch(chunk, archiveId);
		itemMetadataUpdateMs += Date.now() - metadataStartedAt;
	}

	const barcodesToInsert: Array<{
		id: string;
		retailerItemId: string;
		barcode: string;
		isPrimary: boolean;
		createdAt: Date;
	}> = [];

	for (let i = 0; i < rows.length; i += 1) {
		const itemId = rowItemIds[i];
		const row = rows[i].row;
		const primaryBarcode = row.barcodes[0] ?? null;

		for (const barcode of row.barcodes) {
			const pairKey = `${itemId}:${barcode}`;
			if (state.knownItemBarcodePairs.has(pairKey)) {
				continue;
			}
			state.knownItemBarcodePairs.add(pairKey);
			state.cacheByBarcode.set(barcodeCacheKey(chainSlug, barcode), itemId);
			barcodesToInsert.push({
				id: generatePrefixedId("rib"),
				retailerItemId: itemId,
				barcode,
				isPrimary: barcode === primaryBarcode,
				createdAt: new Date(),
			});
		}
	}

	for (const chunk of chunkArray(barcodesToInsert, state.batchSize)) {
		const barcodeInsertStartedAt = Date.now();
		await db.insert(retailerItemBarcodes).values(chunk).onConflictDoNothing();
		barcodeInsertMs += Date.now() - barcodeInsertStartedAt;
	}

	return {
		itemIds: rowItemIds,
		itemInsertMs,
		itemMetadataUpdateMs,
		barcodeInsertMs,
	};
}

function buildValidationErrors(row: NormalizedRow, errors: string[]) {
	return errors.map((message) => ({
		field: undefined,
		message,
		code: "validation",
		value: row.rawData,
	}));
}

async function createArchiveRecord(
	chainSlug: string,
	file: DiscoveredFile,
	content: Buffer,
	storageKey: string,
	runId: string,
): Promise<string> {
	const storage = getStorage();
	const downloadedAt = new Date();
	const archiveId = generatePrefixedId("arc");

	await storage.put(storageKey, content, {
		originalName: file.filename,
		chainSlug,
		sourceUrl: file.url,
		downloadedAt,
		custom: {
			file_type: file.type,
		},
	});

	const info = await storage.getInfo(storageKey);
	const compressed = info.metadata?.custom?.compressed === "true";
	const originalSize = compressed
		? Number(info.metadata?.custom?.original_size ?? content.length)
		: content.length;

	await getDatabase()
		.insert(archives)
		.values({
			id: archiveId,
			chainSlug,
			sourceUrl: file.url,
			filename: file.filename,
			originalFormat: file.type,
			archivePath: storageKey,
			archiveType: "local",
			contentType: info.metadata?.contentType,
			fileSize: originalSize,
			compressedSize: compressed ? info.size : null,
			isCompressed: compressed,
			checksum: info.checksum,
			downloadedAt,
			metadata: {
				originalFilename: file.filename,
				fileType: file.type,
			},
			createdAt: new Date(),
			updatedAt: new Date(),
			runId,
		});

	return archiveId;
}

async function recordParquetFile(
	chainSlug: string,
	targetDate: Date,
	storageKey: string,
): Promise<void> {
	const storage = getStorage();
	const info = await storage.getInfo(storageKey);
	const db = getDatabase();

	const targetDateStr = targetDate.toISOString().split("T")[0];
	await db
		.insert(parquetFiles)
		.values({
			chainSlug,
			targetDate: targetDateStr,
			storageKey,
			fileSize: info.size,
			checksum: info.checksum,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: parquetFiles.storageKey,
			set: {
				chainSlug,
				targetDate: targetDateStr,
				fileSize: info.size,
				checksum: info.checksum,
				updatedAt: new Date(),
			},
		});
}

async function insertErrors(
	errors: Array<{
		runId: string;
		fileId: bigint;
		errorType: string;
		errorMessage: string;
		errorDetails?: string | null;
		severity?: string;
		entryId?: string | null;
	}>,
	batchSize: number,
): Promise<void> {
	if (errors.length === 0) {
		return;
	}
	for (const chunk of chunkArray(errors, batchSize)) {
		await getDatabase()
			.insert(ingestionErrors)
			.values(
				chunk.map((err) => ({
					runId: err.runId,
					fileId: err.fileId,
					errorType: err.errorType,
					errorMessage: err.errorMessage,
					errorDetails: err.errorDetails ?? null,
					severity: err.severity ?? "error",
					entryId: err.entryId ?? null,
					createdAt: new Date(),
				})),
			);
	}
}

async function insertFailedRows(
	rows: Array<{
		chainSlug: string;
		runId: string;
		fileId: bigint;
		storeIdentifier: string;
		row: NormalizedRow;
		errors: string[];
	}>,
	batchSize: number,
): Promise<void> {
	if (rows.length === 0) {
		return;
	}

	for (const chunk of chunkArray(rows, batchSize)) {
		await getDatabase()
			.insert(retailerItemsFailed)
			.values(
				chunk.map((entry) => ({
					id: generatePrefixedId("id"),
					chainSlug: entry.chainSlug,
					runId: entry.runId,
					fileId: entry.fileId,
					storeIdentifier: entry.storeIdentifier,
					rowNumber: entry.row.rowNumber,
					rawData: entry.row.rawData,
					validationErrors: buildValidationErrors(entry.row, entry.errors),
				})),
			);
	}
}

function mapParseErrors(
	runId: string,
	fileId: bigint,
	parseResult: ParseResult,
): Array<{
	runId: string;
	fileId: bigint;
	errorType: string;
	errorMessage: string;
	errorDetails?: string | null;
	severity?: string;
	entryId?: string | null;
}> {
	return parseResult.errors.map((err) => ({
		runId,
		fileId,
		errorType: "parse",
		errorMessage: err.message,
		errorDetails: JSON.stringify({
			rowNumber: err.rowNumber,
			field: err.field,
			originalValue: err.originalValue,
		}),
		severity: "error",
		entryId: err.rowNumber ? String(err.rowNumber) : null,
	}));
}

async function processIngestionFile(options: {
	runId: string;
	chainSlug: string;
	targetDate: Date;
	adapter: ChainAdapter;
	fileEntry: FileToProcess;
	storeIdentifierType: string;
	performanceConfig: IngestionPerformanceConfig;
	storeCache: Map<string, string>;
	storeResolveInFlight: Map<string, Promise<string>>;
	itemState: ItemPersistenceState;
	itemWriteSharder: ItemWriteSharder;
}): Promise<ProcessedFileResult> {
	const db = getDatabase();
	const {
		runId,
		chainSlug,
		targetDate,
		adapter,
		fileEntry,
		storeIdentifierType,
		performanceConfig,
		storeCache,
		storeResolveInFlight,
		itemState,
		itemWriteSharder,
	} = options;

	const [fileRow] = await db
		.insert(ingestionFiles)
		.values({
			runId,
			filename: fileEntry.filename,
			fileType: fileEntry.type,
			fileSize: fileEntry.content.length,
			fileHash: fileEntry.hash,
			status: "processing",
			metadata: JSON.stringify({
				sourceUrl: fileEntry.file.url,
				archiveId: fileEntry.archiveId,
				storageKey:
					fileEntry.tempStorageKey ??
					(fileEntry.expandedFrom
						? buildExpandedKey(
								chainSlug,
								targetDate,
								fileEntry.expandedFrom,
								fileEntry.filename,
							)
						: buildArchiveKey(chainSlug, targetDate, fileEntry.filename)),
				parentFilename: fileEntry.expandedFrom,
			}),
			createdAt: new Date(),
		})
		.returning({ id: ingestionFiles.id });

	if (!fileRow) {
		throw new Error(
			`Failed to create ingestion file record for ${fileEntry.filename}`,
		);
	}

	const fileId = fileRow.id;
	let fileErrorCount = 0;
	let fileWarningRows = 0;
	let fileFailedRows = 0;
	const parseStart = Date.now();
	const parseResult = await adapter.parse(
		fileEntry.content,
		fileEntry.filename,
	);
	const parseDurationMs = Date.now() - parseStart;

	fileErrorCount += parseResult.errors.length;
	const parseErrors = mapParseErrors(runId, fileId, parseResult);
	await insertErrors(parseErrors, performanceConfig.dbBatchSize);

	const failedRows: Array<{
		chainSlug: string;
		runId: string;
		fileId: bigint;
		storeIdentifier: string;
		row: NormalizedRow;
		errors: string[];
	}> = [];

	const validationErrors: Array<{
		runId: string;
		fileId: bigint;
		errorType: string;
		errorMessage: string;
		errorDetails?: string | null;
		severity?: string;
		entryId?: string | null;
	}> = [];

	const validRows: ValidRowForPersistence[] = [];
	const priceAvailability = emptyPriceAvailabilityStats();
	const storeMetadata = adapter.extractStoreMetadata(fileEntry.file);

	for (const row of parseResult.rows) {
		const storeIdentifier =
			row.storeIdentifier?.trim() ||
			adapter.extractStoreIdentifier(fileEntry.file)?.value ||
			"";

		if (!storeIdentifier) {
			fileFailedRows += 1;
			validationErrors.push({
				runId,
				fileId,
				errorType: "store_resolution",
				errorMessage: "Missing store identifier",
				errorDetails: JSON.stringify({ rowNumber: row.rowNumber }),
				severity: "error",
				entryId: String(row.rowNumber),
			});
			continue;
		}

		const validation = adapter.validateRow(row);
		if (!validation.isValid) {
			fileFailedRows += 1;
			fileErrorCount += 1;
			failedRows.push({
				chainSlug,
				runId,
				fileId,
				storeIdentifier,
				row,
				errors: validation.errors,
			});
			validationErrors.push({
				runId,
				fileId,
				errorType: "validation",
				errorMessage: validation.errors.join("; "),
				errorDetails: JSON.stringify({ rowNumber: row.rowNumber }),
				severity: "error",
				entryId: String(row.rowNumber),
			});
			continue;
		}

		const storeId = await resolveStoreId(
			chainSlug,
			storeIdentifier,
			storeIdentifierType,
			storeMetadata,
			storeCache,
			storeResolveInFlight,
		);
		const hasWarning = validation.warnings.length > 0;
		if (hasWarning) {
			fileWarningRows += 1;
		}

		if (row.priceStatus === "available") {
			priceAvailability.availableRows += 1;
		} else {
			priceAvailability.unavailableRows += 1;
			trackUnavailableReason(priceAvailability, row.priceUnavailableReason);
		}

		validRows.push({
			row,
			storeId,
			storeIdentifier,
			hasWarning,
		});
	}

	await insertFailedRows(failedRows, performanceConfig.dbBatchSize);
	await insertErrors(validationErrors, performanceConfig.dbBatchSize);

	let deadlockRetries = 0;
	let itemInsertMs = 0;
	let itemMetadataUpdateMs = 0;
	let barcodeInsertMs = 0;
	const itemResolveStartedAt = Date.now();

	const itemIds = new Array<string>(validRows.length);
	const shardGroups = new Map<
		number,
		{ indexes: number[]; rows: ValidRowForPersistence[] }
	>();
	for (const [index, validRow] of validRows.entries()) {
		const itemWriteKey = buildItemWriteKey(validRow, index);
		const shardIndex = itemWriteSharder.shardForKey(itemWriteKey);
		const group = shardGroups.get(shardIndex);
		if (group) {
			group.indexes.push(index);
			group.rows.push(validRow);
		} else {
			shardGroups.set(shardIndex, { indexes: [index], rows: [validRow] });
		}
	}

	const shardResults = await Promise.all(
		Array.from(shardGroups.entries()).map(async ([shardIndex, group]) => {
			const resolved = await itemWriteSharder.enqueueShard(shardIndex, () =>
				withDeadlockRetry(
					"resolveRetailerItemsForRows",
					() =>
						resolveRetailerItemsForRows(
							chainSlug,
							group.rows,
							fileEntry.archiveId,
							itemState,
						),
					{
						maxAttempts: performanceConfig.itemWriteRetryMax,
						baseBackoffMs: performanceConfig.itemWriteRetryBaseMs,
						onRetry: () => {
							deadlockRetries += 1;
						},
					},
				),
			);

			return { group, resolved };
		}),
	);

	for (const shardResult of shardResults) {
		const { group, resolved } = shardResult;
		itemInsertMs += resolved.itemInsertMs;
		itemMetadataUpdateMs += resolved.itemMetadataUpdateMs;
		barcodeInsertMs += resolved.barcodeInsertMs;
		for (let i = 0; i < group.indexes.length; i += 1) {
			itemIds[group.indexes[i]] = resolved.itemIds[i];
		}
	}

	const itemResolveMs = Date.now() - itemResolveStartedAt;

	const storeStats = new Map<
		string,
		{
			storeId: string;
			storeIdentifier: string;
			rowCount: number;
			persistedCount: number;
			failedRows: number;
			warningRows: number;
		}
	>();
	const localParquetRows: ParquetPriceRow[] = [];

	for (let i = 0; i < validRows.length; i += 1) {
		const validRow = validRows[i];
		const itemId = itemIds[i];
		const primaryBarcode = validRow.row.barcodes[0] ?? null;

		localParquetRows.push({
			target_date: targetDate,
			chain_slug: chainSlug,
			store_id: validRow.storeId,
			retailer_item_id: itemId,
			external_id: validRow.row.externalId ?? null,
			name: validRow.row.name,
			barcode: primaryBarcode,
			price_cents: validRow.row.price,
			price_status: validRow.row.priceStatus,
			price_unavailable_reason: validRow.row.priceUnavailableReason ?? null,
			discount_price_cents: validRow.row.discountPrice ?? null,
			unit_price_cents: validRow.row.unitPrice ?? null,
			category: validRow.row.category ?? null,
			brand: validRow.row.brand ?? null,
		});

		const current = storeStats.get(validRow.storeIdentifier);
		if (current) {
			current.rowCount += 1;
			current.persistedCount += 1;
			current.warningRows += validRow.hasWarning ? 1 : 0;
		} else {
			storeStats.set(validRow.storeIdentifier, {
				storeId: validRow.storeId,
				storeIdentifier: validRow.storeIdentifier,
				rowCount: 1,
				persistedCount: 1,
				failedRows: 0,
				warningRows: validRow.hasWarning ? 1 : 0,
			});
		}
	}

	if (storeStats.size > 0) {
		await db.insert(ingestionStoreStats).values(
			Array.from(storeStats.values()).map((stat) => ({
				runId,
				fileId,
				storeId: stat.storeId,
				storeIdentifier: stat.storeIdentifier,
				rowCount: stat.rowCount,
				persistedCount: stat.persistedCount,
				failedRows: stat.failedRows,
				warningRows: stat.warningRows,
				priceChanges: 0,
				createdAt: new Date(),
			})),
		);
	}

	await db
		.update(ingestionFiles)
		.set({
			entryCount: parseResult.totalRows,
			status: "completed",
			statusSeverity: fileErrorCount > 0 ? "warning" : null,
			processedAt: new Date(),
			processedChunks: 0,
			totalChunks: 0,
			metadata: JSON.stringify({
				sourceUrl: fileEntry.file.url,
				archiveId: fileEntry.archiveId,
				rowCount: parseResult.totalRows,
				processedRows: validRows.length,
				failedRows: fileFailedRows,
				warningRows: fileWarningRows,
				parseDurationMs,
				itemResolveMs,
				itemInsertMs,
				itemMetadataUpdateMs,
				barcodeInsertMs,
				deadlockRetries,
				priceAvailability,
			}),
		})
		.where(eq(ingestionFiles.id, fileId));

	return {
		totalRows: parseResult.totalRows,
		processedRows: validRows.length,
		warningRows: fileWarningRows,
		failedRows: fileFailedRows,
		errorCount: fileErrorCount,
		parquetRows: localParquetRows,
		itemResolveMs,
		itemInsertMs,
		itemMetadataUpdateMs,
		barcodeInsertMs,
		deadlockRetries,
		priceAvailability,
	};
}

export async function runIngestion(
	options: IngestionOptions,
): Promise<IngestionResult> {
	const db = getDatabase();
	const { date: targetDate, dateStr } = parseTargetDate(options.targetDate);
	const chainSlug = options.chainSlug;
	const source = options.source ?? "worker";

	log.info("Starting ingestion", { chainSlug, targetDate: dateStr });

	if (!options.force) {
		const existing = await db
			.select({ id: ingestionRuns.id, status: ingestionRuns.status })
			.from(ingestionRuns)
			.where(
				and(
					eq(ingestionRuns.chainSlug, chainSlug),
					eq(ingestionRuns.targetDate, targetDate),
					inArray(ingestionRuns.status, ["pending", "running", "completed"]),
				),
			)
			.limit(1);

		if (existing[0]) {
			return {
				runId: existing[0].id,
				status: "skipped",
				message: "Duplicate ingestion run exists",
			};
		}
	}

	const runId = generatePrefixedId("run");
	const startedAt = new Date();

	// Wrap run creation and lock acquisition in a transaction for atomicity
	const { lockAcquired } = await db.transaction(async (tx) => {
		await tx.insert(ingestionRuns).values({
			id: runId,
			chainSlug,
			source,
			status: "running",
			startedAt,
			targetDate,
			isForced: options.force ?? false,
			parentRunId: options.parentRunId ?? null,
			rerunType: options.rerunType ?? null,
			rerunTargetId: options.rerunTargetId ?? null,
			createdAt: startedAt,
		});

		let lockAcquired = true;
		if (options.taskId) {
			try {
				await tx.insert(activeIngestionOperations).values({
					chainSlug,
					targetDate: dateStr,
					taskId: options.taskId,
				});
			} catch {
				lockAcquired = false;
			}
		}

		return { lockAcquired };
	});

	if (!lockAcquired) {
		log.warn("Active ingestion lock already held", {
			chainSlug,
			targetDate: dateStr,
		});
		// Update run status outside transaction since transaction committed
		await db
			.update(ingestionRuns)
			.set({
				status: "failed",
				statusReason: "Another ingestion already running",
				statusSeverity: "warning",
				completedAt: new Date(),
			})
			.where(eq(ingestionRuns.id, runId));
		return { runId, status: "skipped", message: "Already running" };
	}

	let totalEntries = 0;
	let processedEntries = 0;
	let errorCount = 0;
	let processedFiles = 0;
	let totalFiles = 0;
	let itemResolveMsTotal = 0;
	let itemInsertMsTotal = 0;
	let itemMetadataUpdateMsTotal = 0;
	let barcodeInsertMsTotal = 0;
	let deadlockRetriesTotal = 0;
	const priceAvailabilityTotals = emptyPriceAvailabilityStats();
	let tempDirPath: string | null = null;
	const performanceConfig = getIngestionPerformanceConfig();

	const parquetRows: ParquetPriceRow[] = [];
	const storeCache = new Map<string, string>();
	const storeResolveInFlight = new Map<string, Promise<string>>();
	const itemState: ItemPersistenceState = {
		cacheByExternalId: new Map<string, string>(),
		cacheByBarcode: new Map<string, string>(),
		updatedItemIds: new Set<string>(),
		knownItemBarcodePairs: new Set<string>(),
		batchSize: performanceConfig.itemWriteBatchSize,
	};
	const itemWriteSharder = createItemWriteSharder(
		performanceConfig.itemWriteShards,
	);

	try {
		const adapter = getAdapter(chainSlug as never);
		const runWallStart = Date.now();
		const discoverStartedAt = Date.now();
		const discoveredFiles = await adapter.discover(dateStr);
		const discoverDurationMs = Date.now() - discoverStartedAt;
		log.info("Discovered files", { chainSlug, count: discoveredFiles.length });
		const storeIdentifierType = buildStoreIdentifierType(chainSlug);

		// Create timestamp for this ingestion run (for temp expanded files)
		const timestamp = formatTimestamp(new Date());

		const filesToProcess: FileToProcess[] = [];

		const fetchStartedAt = Date.now();
		let fileIndex = 0;
		for (const file of discoveredFiles) {
			fileIndex++;
			if (fileIndex % 20 === 1 || fileIndex === discoveredFiles.length) {
				log.info("Fetching files", {
					progress: `${fileIndex}/${discoveredFiles.length}`,
				});
			}
			const fetched = await adapter.fetch(file);
			const archiveKey = buildArchiveKey(chainSlug, targetDate, file.filename);
			const archiveId = await createArchiveRecord(
				chainSlug,
				file,
				fetched.content,
				archiveKey,
				runId,
			);

			if (file.type === "zip" && adapter.expandZip) {
				const expanded = await adapter.expandZip(
					fetched.content,
					file.filename,
				);

				// Create temp directory for expanded files (only once)
				if (!tempDirPath) {
					tempDirPath = await createTempDir(
						"expanded",
						`${timestamp}-${chainSlug}`,
					);
					log.info("Created temporary directory for expanded files", {
						path: tempDirPath,
					});
				}

				for (const inner of expanded) {
					const expandedKey = buildTempExpandedKey(
						timestamp,
						chainSlug,
						file.filename,
						inner.innerFilename,
					);
					await getStorage().put(expandedKey, inner.content, {
						originalName: inner.innerFilename,
						chainSlug,
						sourceUrl: file.url,
						downloadedAt: new Date(),
						custom: {
							file_type: inner.type,
						},
					});

					filesToProcess.push({
						file,
						content: inner.content,
						type: inner.type,
						filename: inner.innerFilename,
						hash: inner.hash,
						archiveId,
						expandedFrom: file.filename,
						tempStorageKey: expandedKey,
					});
				}
			} else {
				filesToProcess.push({
					file,
					content: fetched.content,
					type: file.type,
					filename: file.filename,
					hash: fetched.hash,
					archiveId,
				});
			}
		}
		const fetchDurationMs = Date.now() - fetchStartedAt;

		totalFiles = filesToProcess.length;
		await db
			.update(ingestionRuns)
			.set({
				totalFiles,
			})
			.where(eq(ingestionRuns.id, runId));

		const processingStartedAt = Date.now();
		let lastProgressUpdateAt = 0;
		const maybeUpdateProgress = async (force: boolean = false) => {
			const now = Date.now();
			if (
				!force &&
				now - lastProgressUpdateAt < performanceConfig.progressUpdateIntervalMs
			) {
				return;
			}
			lastProgressUpdateAt = now;
			await db
				.update(ingestionRuns)
				.set({
					processedFiles,
					processedEntries,
					totalEntries,
					errorCount,
				})
				.where(eq(ingestionRuns.id, runId));
		};

		await runWithConcurrency(
			filesToProcess,
			performanceConfig.fileConcurrency,
			async (fileEntry, index) => {
				const processed = await processIngestionFile({
					runId,
					chainSlug,
					targetDate,
					adapter,
					fileEntry,
					storeIdentifierType,
					performanceConfig,
					storeCache,
					storeResolveInFlight,
					itemState,
					itemWriteSharder,
				});

				totalEntries += processed.totalRows;
				processedEntries += processed.processedRows;
				errorCount += processed.errorCount;
				itemResolveMsTotal += processed.itemResolveMs;
				itemInsertMsTotal += processed.itemInsertMs;
				itemMetadataUpdateMsTotal += processed.itemMetadataUpdateMs;
				barcodeInsertMsTotal += processed.barcodeInsertMs;
				deadlockRetriesTotal += processed.deadlockRetries;
				priceAvailabilityTotals.availableRows +=
					processed.priceAvailability.availableRows;
				priceAvailabilityTotals.unavailableRows +=
					processed.priceAvailability.unavailableRows;
				priceAvailabilityTotals.unavailableMissingRows +=
					processed.priceAvailability.unavailableMissingRows;
				priceAvailabilityTotals.unavailableInvalidRows +=
					processed.priceAvailability.unavailableInvalidRows;
				priceAvailabilityTotals.unavailableNonPositiveRows +=
					processed.priceAvailability.unavailableNonPositiveRows;
				processedFiles += 1;
				parquetRows.push(...processed.parquetRows);

				if ((index + 1) % 10 === 0 || index + 1 === filesToProcess.length) {
					log.info("Processing files", {
						progress: `${index + 1}/${filesToProcess.length}`,
						processedFiles,
						processedEntries,
						totalEntries,
						errorCount,
					});
				}

				await maybeUpdateProgress(false);
			},
		);
		await maybeUpdateProgress(true);
		const processingDurationMs = Date.now() - processingStartedAt;

		let parquetDurationMs = 0;
		if (parquetRows.length > 0) {
			const parquetStartedAt = Date.now();
			const parquetKey = buildParquetKey(chainSlug, targetDate);
			await writePricesParquet(parquetKey, parquetRows);
			await recordParquetFile(chainSlug, targetDate, parquetKey);
			parquetDurationMs = Date.now() - parquetStartedAt;
		}
		const totalDurationMs = Date.now() - runWallStart;

		await db
			.update(ingestionRuns)
			.set({
				status: "completed",
				completedAt: new Date(),
				statusSeverity: errorCount > 0 ? "warning" : null,
				statusReason: errorCount > 0 ? "Completed with errors" : null,
				totalFiles,
				processedFiles,
				totalEntries,
				processedEntries,
				errorCount,
				metadata: JSON.stringify({
					performance: {
						discoverMs: discoverDurationMs,
						fetchMs: fetchDurationMs,
						processMs: processingDurationMs,
						parquetMs: parquetDurationMs,
						totalMs: totalDurationMs,
						itemResolveMs: itemResolveMsTotal,
						itemInsertMs: itemInsertMsTotal,
						itemMetadataUpdateMs: itemMetadataUpdateMsTotal,
						barcodeInsertMs: barcodeInsertMsTotal,
						deadlockRetries: deadlockRetriesTotal,
					},
					priceAvailability: priceAvailabilityTotals,
				}),
			})
			.where(eq(ingestionRuns.id, runId));

		log.info("Ingestion completed", {
			chainSlug,
			runId,
			totalFiles,
			processedFiles,
			totalEntries,
			processedEntries,
			errorCount,
			durations: {
				discoverMs: discoverDurationMs,
				fetchMs: fetchDurationMs,
				processMs: processingDurationMs,
				parquetMs: parquetDurationMs,
				totalMs: totalDurationMs,
				itemResolveMs: itemResolveMsTotal,
				itemInsertMs: itemInsertMsTotal,
				itemMetadataUpdateMs: itemMetadataUpdateMsTotal,
				barcodeInsertMs: barcodeInsertMsTotal,
				priceAvailability: priceAvailabilityTotals,
			},
			deadlockRetries: deadlockRetriesTotal,
		});

		// Cleanup temp directory on success
		if (tempDirPath) {
			try {
				await deleteTempDir(tempDirPath);
				log.info("Cleaned up temporary directory", { path: tempDirPath });
			} catch (cleanupError) {
				// Don't fail the ingestion if cleanup fails
				log.warn("Failed to cleanup temporary directory", {
					path: tempDirPath,
					error: errorToObject(cleanupError),
				});
			}
		}

		return { runId, status: "completed" };
	} catch (error) {
		log.error("Ingestion failed", {
			chainSlug,
			runId,
			error: errorToObject(error),
		});

		// Leave temp directory on error for debugging
		if (tempDirPath) {
			log.info("Temporary directory left for debugging", {
				path: tempDirPath,
				note: "Will be cleaned up automatically after retention period",
			});
		}

		await db
			.update(ingestionRuns)
			.set({
				status: "failed",
				statusReason: error instanceof Error ? error.message : String(error),
				statusSeverity: "critical",
				completedAt: new Date(),
			})
			.where(eq(ingestionRuns.id, runId));

		return { runId, status: "failed" };
	} finally {
		if (options.taskId) {
			await db
				.delete(activeIngestionOperations)
				.where(eq(activeIngestionOperations.taskId, options.taskId));
		}

		// Attempt best-effort cleanup of old temp dirs on each run
		try {
			const cleaned = await cleanupTempDirs("expanded");
			if (cleaned.length > 0) {
				const totalSize = cleaned.reduce((sum, dir) => sum + dir.sizeBytes, 0);
				log.info("Cleaned up old temporary directories", {
					count: cleaned.length,
					totalSizeBytes: totalSize,
				});
			}
		} catch (cleanupError) {
			// Don't fail if cleanup fails
			log.debug("Background temp cleanup failed", {}, cleanupError);
		}
	}
}

export async function rerunIngestionRun(
	originalRunId: string,
	rerunType: string,
	targetId: string,
	taskId?: string,
): Promise<IngestionResult> {
	const db = getDatabase();
	const [run] = await db
		.select({
			chainSlug: ingestionRuns.chainSlug,
			targetDate: ingestionRuns.targetDate,
		})
		.from(ingestionRuns)
		.where(eq(ingestionRuns.id, originalRunId))
		.limit(1);

	if (!run) {
		throw new Error(`Run not found: ${originalRunId}`);
	}

	const targetDate = run.targetDate?.toISOString().split("T")[0] ?? undefined;

	return runIngestion({
		chainSlug: run.chainSlug,
		targetDate,
		source: "worker",
		force: true,
		parentRunId: originalRunId,
		rerunType,
		rerunTargetId: targetId,
		taskId,
	});
}
