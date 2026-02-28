import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import { IngestionClassifiedError } from "@/ingestion/errors";
import {
	createPricesParquetAppender,
	type ParquetPriceRow,
	type PricesParquetAppender,
} from "@/ingestion/parquet";
import type {
	DiscoveredFile,
	FileType,
	NormalizedRow,
	ParseResult,
	PriceUnavailableReason,
} from "@/ingestion/types";
import { normalizeCategory } from "@/lib/matching/categories";
import { computeNameHash, parseUnit } from "@/lib/matching/normalize";
import { indexRetailerItemsBatch } from "@/lib/search";
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
import { scheduleTask } from "@/lib/taskqueue";
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
	statusType?: string;
	statusSeverity?: "warning" | "error" | "critical";
	retryAt?: string;
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
	parquetMaxPendingWrites: number;
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
	itemIdsToIndex: string[];
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
	cacheByNameHash: Map<string, string>;
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
		fileConcurrency: parsePositiveIntEnv("INGESTION_FILE_CONCURRENCY", 4),
		dbBatchSize: parsePositiveIntEnv("INGESTION_DB_BATCH_SIZE", 1000),
		progressUpdateIntervalMs: parsePositiveIntEnv(
			"INGESTION_PROGRESS_UPDATE_INTERVAL_MS",
			5000,
		),
		itemWriteShards: parsePositiveIntEnv("INGESTION_ITEM_WRITE_SHARDS", 3),
		itemWriteBatchSize: parsePositiveIntEnv(
			"INGESTION_ITEM_WRITE_BATCH_SIZE",
			500,
		),
		itemWriteRetryMax: parsePositiveIntEnv("INGESTION_ITEM_WRITE_RETRY_MAX", 5),
		itemWriteRetryBaseMs: parsePositiveIntEnv(
			"INGESTION_ITEM_WRITE_RETRY_BASE_MS",
			50,
		),
		parquetMaxPendingWrites: parsePositiveIntEnv(
			"INGESTION_PARQUET_MAX_PENDING_WRITES",
			3,
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
		let releaseCurrent: () => void = () => {};
		shardQueues[safeShardIndex] = new Promise<void>((resolve) => {
			releaseCurrent = resolve;
		});

		await previous;
		try {
			return await operation();
		} finally {
			releaseCurrent();
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

function mergeMetadata(
	existing: string | null | undefined,
	additional: Record<string, unknown>,
): string {
	let base: Record<string, unknown> = {};
	if (existing) {
		try {
			const parsed = JSON.parse(existing);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				base = parsed as Record<string, unknown>;
			}
		} catch {
			base = {};
		}
	}
	return JSON.stringify({
		...base,
		...additional,
	});
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
	storeIdentifier: { type: string; value: string },
	metadata: {
		name?: string;
		address?: string;
		city?: string;
		postalCode?: string;
	} | null,
	cache: Map<string, string>,
	inFlightResolutions?: Map<string, Promise<string>>,
): Promise<string> {
	if (!storeIdentifier.value.trim()) {
		throw new Error("resolveStoreId called with empty store identifier");
	}

	const cacheKey = `${chainSlug}:${storeIdentifier.type}:${storeIdentifier.value}`;
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
			.select({
				id: stores.id,
				name: stores.name,
				displayName: stores.displayName,
				displayNameManual: stores.displayNameManual,
				address: stores.address,
				city: stores.city,
				postalCode: stores.postalCode,
			})
			.from(storeIdentifiers)
			.innerJoin(stores, eq(stores.id, storeIdentifiers.storeId))
			.where(
				and(
					eq(storeIdentifiers.chainSlug, chainSlug),
					eq(storeIdentifiers.type, storeIdentifier.type),
					eq(storeIdentifiers.value, storeIdentifier.value),
					eq(stores.chainSlug, chainSlug),
				),
			)
			.limit(1);

		if (existing[0]) {
			const current = existing[0];
			const updateData: Partial<typeof stores.$inferInsert> = {
				updatedAt: new Date(),
			};

			if (!current.address && metadata?.address) {
				updateData.address = metadata.address;
			}
			if (!current.city && metadata?.city) {
				updateData.city = metadata.city;
			}
			if (!current.postalCode && metadata?.postalCode) {
				updateData.postalCode = metadata.postalCode;
			}

			const placeholderName = `${chainSlug.toUpperCase()} ${storeIdentifier.value}`.slice(
				0,
				255,
			);
			if (
				metadata?.name &&
				!current.displayNameManual &&
				(current.name === placeholderName || current.displayName === placeholderName)
			) {
				updateData.name = metadata.name.slice(0, 255);
				updateData.displayName = metadata.name.slice(0, 255);
			}

			if (Object.keys(updateData).length > 1) {
				await db.update(stores).set(updateData).where(eq(stores.id, current.id));
			}

			cache.set(cacheKey, current.id);
			return current.id;
		}

		const storeId = generatePrefixedId("sto");
		const storeName =
			metadata?.name ||
			`${chainSlug.toUpperCase()} ${storeIdentifier.value}`.slice(0, 255);

		await db.insert(stores).values({
			id: storeId,
			chainSlug,
			name: storeName,
			displayName: storeName,
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
			chainSlug,
			type: storeIdentifier.type,
			value: storeIdentifier.value,
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

function nameHashCacheKey(chainSlug: string, nameHash: string): string {
	return `${chainSlug}:namehash:${nameHash}`;
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

async function loadItemsByNameHash(
	chainSlug: string,
	nameHashes: string[],
	batchSize: number,
): Promise<Map<string, string>> {
	const matches = new Map<string, string>();
	if (nameHashes.length === 0) {
		return matches;
	}

	const db = getDatabase();
	for (const chunk of chunkArray(nameHashes, batchSize)) {
		const rows = await db
			.select({
				id: retailerItems.id,
				normalizedNameHash: retailerItems.normalizedNameHash,
			})
			.from(retailerItems)
			.where(
				and(
					eq(retailerItems.chainSlug, chainSlug),
					inArray(retailerItems.normalizedNameHash, chunk),
					sql`${retailerItems.mergedIntoId} IS NULL`,
				),
			)
			.orderBy(retailerItems.createdAt);
		for (const row of rows) {
			if (row.normalizedNameHash && !matches.has(row.normalizedNameHash)) {
				matches.set(row.normalizedNameHash, row.id);
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
	name: string,
): string {
	if (externalId) {
		return `external:${externalId}`;
	}
	const firstBarcode = barcodes[0];
	if (firstBarcode) {
		return `barcode:${firstBarcode}`;
	}
	const hash = computeNameHash(name);
	if (!hash) return `row:${Date.now()}-${Math.random()}`;
	return `name:${hash}`;
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

	// Name-hash resolution for items without externalId and without barcodes
	const knownNameHashes = new Map<string, string>();
	const missingNameHashes = new Set<string>();
	for (const rowEntry of rows) {
		const externalId = normalizeExternalId(rowEntry.row.externalId);
		if (externalId) continue;
		if (rowEntry.row.barcodes.length > 0) continue;
		const nameHash = computeNameHash(rowEntry.row.name);
		if (!nameHash) continue;
		const cached = state.cacheByNameHash.get(
			nameHashCacheKey(chainSlug, nameHash),
		);
		if (cached) {
			knownNameHashes.set(nameHash, cached);
		} else {
			missingNameHashes.add(nameHash);
		}
	}

	const loadedNameHashes = await loadItemsByNameHash(
		chainSlug,
		Array.from(missingNameHashes),
		state.batchSize,
	);
	for (const [nameHash, itemId] of loadedNameHashes) {
		knownNameHashes.set(nameHash, itemId);
		state.cacheByNameHash.set(nameHashCacheKey(chainSlug, nameHash), itemId);
	}

	type NewItemCandidate = {
		provisionalId: string;
		externalId: string | null;
		row: NormalizedRow;
	};

	const rowItemIds = new Array<string>(rows.length);
	const newCandidates = new Map<string, NewItemCandidate>();

	for (const [index, rowEntry] of rows.entries()) {
		const externalId = normalizeExternalId(rowEntry.row.externalId);
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
			// Fall back to name-hash lookup
			if (!resolvedItemId && rowEntry.row.barcodes.length === 0) {
				const nameHash = computeNameHash(rowEntry.row.name);
				if (nameHash) {
					resolvedItemId = knownNameHashes.get(nameHash) ?? null;
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
			rowEntry.row.name,
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
			chunk.map((candidate) => {
				const parsed = parseUnit(
					candidate.row.unit ?? null,
					candidate.row.unitQuantity ?? null,
					candidate.row.name,
				);
				return {
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
					normalizedNameHash: computeNameHash(candidate.row.name),
					normalizedUnit: parsed?.unit ?? null,
					normalizedQuantity: parsed?.quantity ?? null,
					createdAt: new Date(),
				};
			}),
		);
		itemInsertMs += Date.now() - insertStartedAt;
		for (const candidate of chunk) {
			createdItemIds.add(candidate.provisionalId);
			const nameHash = computeNameHash(candidate.row.name);
			if (nameHash) {
				state.cacheByNameHash.set(
					nameHashCacheKey(chainSlug, nameHash),
					candidate.provisionalId,
				);
			}
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
				chunk.map((candidate) => {
					const parsed = parseUnit(
						candidate.row.unit ?? null,
						candidate.row.unitQuantity ?? null,
						candidate.row.name,
					);
					return {
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
						normalizedNameHash: computeNameHash(candidate.row.name),
						normalizedUnit: parsed?.unit ?? null,
						normalizedQuantity: parsed?.quantity ?? null,
						createdAt: new Date(),
					};
				}),
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
		if (createdItemIds.has(itemId)) {
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
	if (parseResult.isErr()) {
		throw new Error(parseResult.error.message);
	}
	const parseDurationMs = Date.now() - parseStart;

	const parsed = parseResult.value;
	fileErrorCount += parsed.errors.length;
	const parseErrors = mapParseErrors(runId, fileId, parsed);
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
	const effectiveFile: DiscoveredFile = {
		...fileEntry.file,
		filename: fileEntry.filename,
		type: fileEntry.type as FileType,
	};
	const storeMetadata = adapter.extractStoreMetadata(effectiveFile);
	const adapterStoreIdentifier = adapter.extractStoreIdentifier(effectiveFile);

	for (const row of parsed.rows) {
		const fallbackIdentifierValue = row.storeIdentifier?.trim() || "";
		const resolvedIdentifier =
			adapterStoreIdentifier?.value?.trim()
				? adapterStoreIdentifier
				: fallbackIdentifierValue
					? { type: storeIdentifierType, value: fallbackIdentifierValue }
					: null;

		if (!resolvedIdentifier?.value) {
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
					storeIdentifier: resolvedIdentifier.value,
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
			{ type: resolvedIdentifier.type, value: resolvedIdentifier.value },
			storeMetadata,
			storeCache,
			storeResolveInFlight,
		);
		const hasWarning = validation.warnings.length > 0;
		if (hasWarning) {
			fileWarningRows += 1;
		}

		// Normalize category for new items
		const normalizedCat = normalizeCategory(
			row.category ?? null,
			row.subcategory ?? null,
		);
		if (normalizedCat) {
			row.category = normalizedCat.category;
			row.subcategory =
				row.subcategory || normalizedCat.subcategory || undefined;
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
			storeIdentifier: resolvedIdentifier.value,
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
			entryCount: parsed.totalRows,
			status: "completed",
			statusSeverity: fileErrorCount > 0 ? "warning" : null,
			processedAt: new Date(),
			processedChunks: 0,
			totalChunks: 0,
			metadata: JSON.stringify({
				sourceUrl: fileEntry.file.url,
				archiveId: fileEntry.archiveId,
				rowCount: parsed.totalRows,
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
		totalRows: parsed.totalRows,
		processedRows: validRows.length,
		warningRows: fileWarningRows,
		failedRows: fileFailedRows,
		errorCount: fileErrorCount,
		parquetRows: localParquetRows,
		itemIdsToIndex: [...new Set(itemIds)],
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
		const activeRun = await db
			.select({ id: ingestionRuns.id, status: ingestionRuns.status })
			.from(ingestionRuns)
			.where(
				and(
					eq(ingestionRuns.chainSlug, chainSlug),
					eq(ingestionRuns.targetDate, targetDate),
					inArray(ingestionRuns.status, ["pending", "running"]),
				),
			)
			.orderBy(desc(ingestionRuns.createdAt))
			.limit(1);

		if (activeRun[0]) {
			return {
				runId: activeRun[0].id,
				status: "skipped",
				message: "Ingestion already pending or running for target date",
			};
		}

		const completedRun = await db
			.select({
				id: ingestionRuns.id,
				totalEntries: ingestionRuns.totalEntries,
				processedEntries: ingestionRuns.processedEntries,
				statusType: ingestionRuns.statusType,
				statusReason: ingestionRuns.statusReason,
				createdAt: ingestionRuns.createdAt,
			})
			.from(ingestionRuns)
			.where(
				and(
					eq(ingestionRuns.chainSlug, chainSlug),
					eq(ingestionRuns.targetDate, targetDate),
					eq(ingestionRuns.status, "completed"),
				),
			)
			.orderBy(desc(ingestionRuns.createdAt))
			.limit(1);

		const latestCompleted = completedRun[0];
		if (latestCompleted) {
			const totalEntries = Number(latestCompleted.totalEntries ?? 0);
			const processedEntries = Number(latestCompleted.processedEntries ?? 0);
			const hasIngestedData = totalEntries > 0 || processedEntries > 0;

			if (hasIngestedData) {
				return {
					runId: latestCompleted.id,
					status: "skipped",
					message: "Ingestion already completed with data for target date",
				};
			}

			log.info("Retrying completed ingestion run with no ingested entries", {
				chainSlug,
				targetDate: dateStr,
				previousRunId: latestCompleted.id,
				previousStatusType: latestCompleted.statusType,
				previousStatusReason: latestCompleted.statusReason,
				previousCreatedAt: latestCompleted.createdAt?.toISOString(),
			});
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

	const itemIdsForSearchIndex = new Set<string>();
	const storeCache = new Map<string, string>();
	const storeResolveInFlight = new Map<string, Promise<string>>();
	const itemState: ItemPersistenceState = {
		cacheByExternalId: new Map<string, string>(),
		cacheByBarcode: new Map<string, string>(),
		cacheByNameHash: new Map<string, string>(),
		updatedItemIds: new Set<string>(),
		knownItemBarcodePairs: new Set<string>(),
		batchSize: performanceConfig.itemWriteBatchSize,
	};
	const itemWriteSharder = createItemWriteSharder(
		performanceConfig.itemWriteShards,
	);
	const parquetKey = buildParquetKey(chainSlug, targetDate);
	let parquetRowsWritten = 0;
	let parquetDurationMs = 0;
	let parquetAppenderPromise: Promise<PricesParquetAppender> | null = null;
	const pendingParquetWrites = new Set<Promise<void>>();

	const getParquetAppender = (): Promise<PricesParquetAppender> => {
		if (!parquetAppenderPromise) {
			parquetAppenderPromise = createPricesParquetAppender(parquetKey);
		}
		return parquetAppenderPromise;
	};

	const scheduleParquetWrite = async (
		rows: ParquetPriceRow[],
	): Promise<void> => {
		if (rows.length === 0) {
			return;
		}

		parquetRowsWritten += rows.length;
		const parquetAppendStartedAt = Date.now();
		const writePromise = (async () => {
			const parquetAppender = await getParquetAppender();
			await parquetAppender.appendRows(rows);
			parquetDurationMs += Date.now() - parquetAppendStartedAt;
		})();

		pendingParquetWrites.add(writePromise);
		void writePromise.finally(() => {
			pendingParquetWrites.delete(writePromise);
		});

		if (
			pendingParquetWrites.size >= performanceConfig.parquetMaxPendingWrites
		) {
			await Promise.race(pendingParquetWrites);
		}
	};

	try {
		const adapter = getAdapter(chainSlug as never);
		const runWallStart = Date.now();
		const discoverStartedAt = Date.now();
		const discoverResult = await adapter.discover(dateStr);
		if (discoverResult.isErr()) {
			const discoverError = discoverResult.error;
			if (discoverError._tag === "IngestionClassified") {
				throw new IngestionClassifiedError(discoverError.classification);
			}
			throw new Error(discoverError.message);
		}
		const discoveredFiles = discoverResult.value;
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
			const fetchResult = await adapter.fetch(file);
			if (fetchResult.isErr()) {
				throw new Error(fetchResult.error.message);
			}
			const fetched = fetchResult.value;
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

				for (const itemId of processed.itemIdsToIndex) {
					itemIdsForSearchIndex.add(itemId);
				}

				await scheduleParquetWrite(processed.parquetRows);

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
		if (pendingParquetWrites.size > 0) {
			await Promise.all(Array.from(pendingParquetWrites));
		}
		await maybeUpdateProgress(true);
		const processingDurationMs = Date.now() - processingStartedAt;

		let searchIndexDurationMs = 0;
		if (parquetRowsWritten > 0) {
			const parquetFinalizeStartedAt = Date.now();
			const parquetAppender = await getParquetAppender();
			await parquetAppender.close();
			await recordParquetFile(chainSlug, targetDate, parquetKey);
			parquetDurationMs += Date.now() - parquetFinalizeStartedAt;

			const searchIndexStartedAt = Date.now();
			const itemIdsToIndex = Array.from(itemIdsForSearchIndex);

			try {
				await indexRetailerItemsBatch(itemIdsToIndex);
				searchIndexDurationMs = Date.now() - searchIndexStartedAt;
				log.info("Search index updated", {
					indexed: itemIdsToIndex.length,
					durationMs: searchIndexDurationMs,
				});
			} catch (searchError) {
				log.warn("Search indexing failed (non-fatal)", {
					error: errorToObject(searchError),
					itemCount: itemIdsToIndex.length,
				});
			}
		}

		try {
			await scheduleTask({
				taskType: "categorize",
				payload: {
					type: "categorize",
					runId,
					chainSlug,
				},
			});
			log.info("Queued categorization task", {
				runId,
				chainSlug,
			});
		} catch (categorizationScheduleError) {
			log.warn("Failed to queue categorization task (non-fatal)", {
				error: errorToObject(categorizationScheduleError),
				runId,
				chainSlug,
			});
		}

		if (source !== "scheduled") {
			try {
				await scheduleTask({
					taskType: "clickhouse",
					priority: 12,
					payload: {
						type: "clickhouseSync",
						mode: "missing",
					},
				});
				log.info("Queued ClickHouse sync task", { runId, chainSlug, source });
			} catch (clickhouseScheduleError) {
				log.warn("Failed to queue ClickHouse sync task (non-fatal)", {
					error: errorToObject(clickhouseScheduleError),
					runId,
					chainSlug,
					source,
				});
			}
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
						searchIndexMs: searchIndexDurationMs,
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
				searchIndexMs: searchIndexDurationMs,
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

		if (parquetAppenderPromise) {
			try {
				const parquetAppender = await parquetAppenderPromise;
				await parquetAppender.close();
			} catch (closeError) {
				log.warn("Failed to close parquet writer after ingestion error", {
					error: errorToObject(closeError),
				});
			}
		}

		// Leave temp directory on error for debugging
		if (tempDirPath) {
			log.info("Temporary directory left for debugging", {
				path: tempDirPath,
				note: "Will be cleaned up automatically after retention period",
			});
		}

		if (error instanceof IngestionClassifiedError) {
			const retryAt = error.classification.retryAt;
			await db
				.update(ingestionRuns)
				.set({
					status: error.classification.status,
					statusType: error.classification.statusType,
					statusSeverity: error.classification.statusSeverity,
					statusReason: error.classification.statusReason,
					completedAt: new Date(),
					metadata: mergeMetadata(null, {
						classification: {
							statusType: error.classification.statusType,
							statusSeverity: error.classification.statusSeverity,
							retryAt: retryAt?.toISOString(),
						},
						...(error.classification.metadata ?? {}),
					}),
				})
				.where(eq(ingestionRuns.id, runId));

			return {
				runId,
				status: error.classification.status,
				message: error.classification.statusReason,
				statusType: error.classification.statusType,
				statusSeverity: error.classification.statusSeverity,
				retryAt: retryAt?.toISOString(),
			};
		}

		const errorMessage = error instanceof Error ? error.message : String(error);
		const statusType = errorMessage.startsWith("Failed to fetch")
			? "source_fetch_error"
			: "pipeline_error";

		await db
			.update(ingestionRuns)
			.set({
				status: "failed",
				statusType,
				statusReason: errorMessage,
				statusSeverity: "critical",
				completedAt: new Date(),
			})
			.where(eq(ingestionRuns.id, runId));

		return {
			runId,
			status: "failed",
			message: errorMessage,
			statusType,
			statusSeverity: "critical",
		};
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
