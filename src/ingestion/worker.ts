/**
 * Ingestion Worker for Cloudflare Workers
 *
 * Handles the ingestion pipeline in production using Cloudflare Queues.
 * Processes queue messages for: discover, fetch, expand, parse, persist
 * Scheduled handler triggers periodic ingestion runs.
 */

import { eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { createDb, type Database } from "@/db";
import {
	ingestionChunks,
	ingestionFiles,
	ingestionRuns,
	storeEnrichmentTasks,
	stores,
} from "@/db/schema";
import { generatePrefixedId } from "@/utils/id";
import {
	CHAIN_IDS,
	type ChainId,
	chainAdapterRegistry,
	isValidChainId,
} from "./chains";
import { persistRowsForStore } from "./core/persist";
import {
	checkAndUpdateRunCompletion,
	incrementErrorCount,
	incrementProcessedEntries,
	incrementProcessedFiles,
	initializeRunStats,
	markRunFailed,
	recordTotalFiles,
} from "./core/run-stats";
import {
	computeSha256,
	generateStorageKey,
	R2Storage,
	type Storage,
} from "./core/storage";
import {
	type DiscoveredFile,
	type DiscoverQueueMessage,
	type EnrichStoreQueueMessage,
	type ExpandQueueMessage,
	type FetchQueueMessage,
	type FileType,
	isDiscoverMessage,
	isEnrichStoreMessage,
	isExpandMessage,
	isFetchMessage,
	isParseChunkedMessage,
	isParseMessage,
	isPersistChunkMessage,
	isPersistMessage,
	isRerunMessage,
	type NormalizedRow,
	type ParseChunkedQueueMessage,
	type ParseQueueMessage,
	type PersistChunkQueueMessage,
	type PersistQueueMessage,
	type QueueMessage,
	type RerunQueueMessage,
} from "./core/types";
import { geocodeAddress } from "./services/geocoding";
import { createLogger } from "@/utils/logger";

const log = createLogger("ingestion");

// ============================================================================
// Worker Environment Types
// ============================================================================

/**
 * Extended environment bindings for the ingestion worker.
 * Extends the base Env with R2 and Queue bindings.
 */
export interface IngestionEnv {
	/** D1 database binding */
	DB: D1Database;
	/** R2 bucket for file storage */
	INGESTION_BUCKET: R2Bucket;
	/** Queue for ingestion messages */
	INGESTION_QUEUE: Queue<QueueMessage>;
	/** Dead letter queue for failed messages */
	INGESTION_DLQ?: Queue<QueueMessage>;
	/** Chains to process on scheduled runs (comma-separated) */
	INGESTION_CHAINS?: string;
	/** Maximum retries before sending to DLQ */
	MAX_RETRIES?: string;
}

// Note: Adapters are automatically registered when importing from './chains'.
// The chainAdapterRegistry is pre-populated and ready to use.

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get today's date in YYYY-MM-DD format.
 */
function getTodayDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Detect file type from filename extension.
 */
function detectFileType(filename: string): FileType {
	const ext = filename.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "csv":
			return "csv";
		case "xml":
			return "xml";
		case "xlsx":
			return "xlsx";
		case "zip":
			return "zip";
		default:
			return "csv";
	}
}

/**
 * Create a queue message with common fields.
 */
function createMessage<T extends QueueMessage["type"]>(
	type: T,
	runId: string,
	chainSlug: string,
): QueueMessageBase & { type: T } {
	return {
		id: generatePrefixedId("msg"),
		type,
		runId,
		chainSlug,
		createdAt: new Date().toISOString(),
	} as QueueMessageBase & { type: T };
}

interface QueueMessageBase {
	id: string;
	type: string;
	runId: string;
	chainSlug: string;
	createdAt: string;
}

/**
 * Parse configured chains from environment.
 */
function getConfiguredChains(env: IngestionEnv): ChainId[] {
	if (!env.INGESTION_CHAINS) {
		// Default to all chains
		return [...CHAIN_IDS];
	}

	const configured = env.INGESTION_CHAINS.split(",")
		.map((s) => s.trim())
		.filter(isValidChainId);

	return configured.length > 0 ? configured : [...CHAIN_IDS];
}

/**
 * Get maximum retries from environment.
 */
function getMaxRetries(env: IngestionEnv): number {
	const value = env.MAX_RETRIES;
	if (!value) return 3;
	const parsed = parseInt(value, 10);
	return Number.isNaN(parsed) ? 3 : parsed;
}

/**
 * Cloudflare Queue batch size limit.
 */
const QUEUE_BATCH_LIMIT = 100;

/**
 * Send messages to queue in batches, respecting the 100 message limit.
 */
async function sendBatchChunked<T extends QueueMessage>(
	queue: Queue<QueueMessage>,
	messages: T[],
): Promise<void> {
	for (let i = 0; i < messages.length; i += QUEUE_BATCH_LIMIT) {
		const chunk = messages.slice(i, i + QUEUE_BATCH_LIMIT);
		await queue.sendBatch(chunk.map((msg) => ({ body: msg })));
	}
}

// ============================================================================
// Message Handlers
// ============================================================================

/**
 * Handle discover message - find available files from a chain.
 */
async function handleDiscover(
	message: DiscoverQueueMessage,
	env: IngestionEnv,
	_storage: Storage,
	db: Database,
): Promise<void> {
	const adapter = chainAdapterRegistry.getAdapter(message.chainSlug as ChainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain "${message.chainSlug}"`);
	}

	log.info("Starting discovery", { phase: "discover", adapter: adapter.name });

	// Set discovery date if targetDate is provided and adapter supports it
	if (message.targetDate && "setDiscoveryDate" in adapter && typeof adapter.setDiscoveryDate === "function") {
		(adapter.setDiscoveryDate as (date: string) => void)(message.targetDate);
		log.info("Set discovery date", { phase: "discover", targetDate: message.targetDate });
	}

	const files = await adapter.discover();
	log.info("Discovery complete", { phase: "discover", count: files.length, adapter: adapter.name, runId: message.runId });

	// Initialize run stats and record total files (including 0)
	await initializeRunStats(db, message.runId);
	await recordTotalFiles(db, message.runId, files.length);

	if (files.length === 0) {
		log.warn("No files discovered", { phase: "discover", adapter: adapter.name, reason: "no_files_available" });

		// Mark run as completed with 0 files
		await db.update(ingestionRuns)
			.set({
				status: "completed",
				completedAt: new Date(),
				totalFiles: 0,
				processedFiles: 0,
			})
			.where(eq(ingestionRuns.id, message.runId));
		return;
	}

	// Enqueue fetch messages for each file
	const fetchMessages: FetchQueueMessage[] = files.map((file) => ({
		...createMessage("fetch", message.runId, message.chainSlug),
		file,
	}));

	await sendBatchChunked(env.INGESTION_QUEUE, fetchMessages);

	log.info("Enqueued fetch messages", { phase: "discover", count: fetchMessages.length });
}

/**
 * Handle fetch message - download a file and store in R2.
 */
async function handleFetch(
	message: FetchQueueMessage,
	env: IngestionEnv,
	storage: Storage,
	_db: Database,
): Promise<void> {
	const adapter = chainAdapterRegistry.getAdapter(message.chainSlug as ChainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain "${message.chainSlug}"`);
	}

	const { file } = message;
	log.info("Fetching file", { phase: "fetch", filename: file.filename, adapter: adapter.name });

	const fetched = await adapter.fetch(file);
	const r2Key = generateStorageKey(
		message.runId,
		message.chainSlug,
		file.filename,
	);

	// Check for duplicate by hash
	const existing = await storage.head(r2Key);
	if (existing?.sha256 === fetched.hash) {
		log.info("Skipped duplicate file", { phase: "fetch", filename: file.filename });
		return;
	}

	// Store in R2
	await storage.put(r2Key, fetched.content, {
		sha256: fetched.hash,
		customMetadata: {
			filename: file.filename,
			type: file.type,
			url: file.url,
		},
	});

	log.info("Stored file", {
		phase: "fetch",
		filename: file.filename,
		bytes: fetched.content.byteLength,
	});

	// Determine next step based on file type
	if (file.type === "zip") {
		// Enqueue expand message for ZIP files
		const expandMessage: ExpandQueueMessage = {
			...createMessage("expand", message.runId, message.chainSlug),
			r2Key,
			file,
		};
		await env.INGESTION_QUEUE.send(expandMessage);
		log.info("Enqueued expand message", { phase: "fetch", filename: file.filename });
	} else {
		// Enqueue parse_chunked message for non-ZIP files to prevent CPU timeout on large files
		const parseChunkedMessage: ParseChunkedQueueMessage = {
			...createMessage("parse_chunked", message.runId, message.chainSlug),
			r2Key,
			file,
			innerFilename: null,
			hash: fetched.hash,
			chunkSize: 1000, // ~30 messages for 30K rows, each chunk under 30s
		};
		await env.INGESTION_QUEUE.send(parseChunkedMessage);
		log.info("Enqueued parse_chunked message", { phase: "fetch", filename: file.filename });
	}
}

/**
 * Handle expand message - extract files from ZIP and enqueue parse messages.
 */
async function handleExpand(
	message: ExpandQueueMessage,
	env: IngestionEnv,
	storage: Storage,
	_db: Database,
): Promise<void> {
	const { r2Key, file } = message;
	log.info("Expanding file", { phase: "expand", filename: file.filename });

	const result = await storage.get(r2Key);
	if (!result) {
		throw new Error(`ZIP file not found in R2: ${r2Key}`);
	}

	const uint8Content = new Uint8Array(result.content);
	const unzipped = unzipSync(uint8Content);

	const parseMessages: ParseChunkedQueueMessage[] = [];
	let expandedCount = 0;

	for (const [innerFilename, innerContent] of Object.entries(unzipped)) {
		// Skip directories and hidden files
		if (innerFilename.endsWith("/") || innerFilename.startsWith("__MACOSX")) {
			continue;
		}

		const innerType = detectFileType(innerFilename);
		const innerHash = await computeSha256(innerContent);

		// Store expanded file in R2
		const expandedKey = generateStorageKey(
			message.runId,
			message.chainSlug,
			`expanded/${file.filename}/${innerFilename}`,
		);

		await storage.put(expandedKey, innerContent, {
			sha256: innerHash,
			customMetadata: {
				parentFilename: file.filename,
				innerFilename,
				type: innerType,
			},
		});

		// Create parse message
		const expandedFile: DiscoveredFile = {
			...file,
			filename: innerFilename,
			type: innerType,
			size: innerContent.byteLength,
		};

		// Create parse_chunked message for expanded files to prevent CPU timeout
		parseMessages.push({
			...createMessage("parse_chunked", message.runId, message.chainSlug),
			r2Key: expandedKey,
			file: expandedFile,
			innerFilename,
			hash: innerHash,
			chunkSize: 1000, // ~30 messages for 30K rows, each chunk under 30s
		});

		expandedCount++;
	}

	if (parseMessages.length > 0) {
		await sendBatchChunked(env.INGESTION_QUEUE, parseMessages);
	}

	log.info("Expanded files", {
		phase: "expand",
		expandedCount,
		enqueuedCount: parseMessages.length,
	});
}

/**
 * Handle parse message - parse file and persist to database.
 */
async function handleParse(
	message: ParseQueueMessage,
	env: IngestionEnv,
	storage: Storage,
	db: Database,
): Promise<void> {
	const adapter = chainAdapterRegistry.getAdapter(message.chainSlug as ChainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain "${message.chainSlug}"`);
	}

	const { r2Key, file, innerFilename } = message;
	const filename = innerFilename || file.filename;
	log.info("Parsing file", { phase: "parse", filename, adapter: adapter.name });

	const result = await storage.get(r2Key);
	if (!result) {
		throw new Error(`File not found in R2: ${r2Key}`);
	}

	const parseResult = await adapter.parse(result.content, filename);
	log.info("Parsed rows", {
		phase: "parse",
		validRows: parseResult.validRows,
		totalRows: parseResult.totalRows,
	});

	if (parseResult.errors.length > 0) {
		log.warn("Parse errors", { phase: "parse", errorCount: parseResult.errors.length });
	}

	// Create file record in database
	const fileId = generatePrefixedId("igf");
	const storeIdentifier =
		adapter.extractStoreIdentifier?.(file)?.value || "unknown";

	await db.insert(ingestionFiles).values({
		id: fileId,
		runId: message.runId,
		filename: filename,
		fileType: file.type,
		fileSize: result.content.byteLength,
		fileHash: message.hash,
		status: "processing",
		entryCount: parseResult.rows.length,
		totalChunks: 1,
		processedChunks: 0,
		chunkSize: parseResult.rows.length,
		metadata: JSON.stringify({ storeIdentifier }),
	});

	if (parseResult.rows.length === 0) {
		log.info("No rows to persist", { phase: "parse", filename });
		// Mark file as completed even with no rows
		await db
			.update(ingestionFiles)
			.set({ status: "completed", processedChunks: 1, processedAt: new Date() })
			.where(eq(ingestionFiles.id, fileId));
		return;
	}

	// Group rows by store identifier
	const rowsByStore = new Map<string, NormalizedRow[]>();
	for (const row of parseResult.rows) {
		const storeId = row.storeIdentifier || "unknown";
		if (!rowsByStore.has(storeId)) {
			rowsByStore.set(storeId, []);
		}
		rowsByStore.get(storeId)?.push(row);
	}

	// Extract store metadata for auto-registration (if adapter supports it)
	const storeMetadata = adapter.extractStoreMetadata?.(file);

	// Persist rows for each store
	let totalPersisted = 0;
	let totalPriceChanges = 0;

	for (const [storeIdentifier, rows] of rowsByStore) {
		try {
			// Build autoRegister options from store metadata
			const autoRegisterOptions = storeMetadata
				? {
						name: storeMetadata.name,
						address: storeMetadata.address,
						city: storeMetadata.city,
					}
				: {
						name: `${adapter.name} Store ${storeIdentifier}`,
					};

			const persistResult = await persistRowsForStore(
				db,
				message.chainSlug,
				storeIdentifier,
				rows,
				"filename_code",
				autoRegisterOptions,
			);

			if (persistResult === null) {
				log.warn("Failed to register store", { phase: "parse", storeIdentifier });
				continue;
			}

			totalPersisted += persistResult.persisted;
			totalPriceChanges += persistResult.priceChanges;

			// Auto-trigger geocoding for new pending stores with address data
			if (persistResult.needsGeocoding && persistResult.storeId) {
				const taskId = generatePrefixedId("set");
				await db.insert(storeEnrichmentTasks).values({
					id: taskId,
					storeId: persistResult.storeId,
					type: "geocode",
					status: "pending",
					inputData: JSON.stringify({
						name: autoRegisterOptions.name,
						address: autoRegisterOptions.address,
						city: autoRegisterOptions.city,
					}),
				});

				const enrichMessage: EnrichStoreQueueMessage = {
					id: generatePrefixedId("msg"),
					type: "enrich_store",
					runId: message.runId,
					chainSlug: message.chainSlug,
					createdAt: new Date().toISOString(),
					storeId: persistResult.storeId,
					taskType: "geocode",
					taskId,
				};
				await env.INGESTION_QUEUE.send(enrichMessage);
				log.info("Queued geocoding for new store", { phase: "parse", storeIdentifier });
			}
		} catch (error) {
			log.error("Failed to persist for store", { phase: "parse", storeIdentifier }, error);
		}
	}

	log.info("Persisted rows", {
		phase: "parse",
		persisted: totalPersisted,
		priceChanges: totalPriceChanges,
	});

	// Mark file as completed
	await db
		.update(ingestionFiles)
		.set({
			status: "completed",
			processedChunks: 1,
			processedAt: new Date(),
		})
		.where(eq(ingestionFiles.id, fileId));

	// Update run progress
	await incrementProcessedFiles(db, message.runId);
	await incrementProcessedEntries(db, message.runId, totalPersisted);

	// Check if run is complete
	try {
		await checkAndUpdateRunCompletion(db, message.runId);
	} catch (error) {
		log.error("Failed to check run completion", { phase: "parse" }, error);
	}
}

/**
 * Handle persist message - persist pre-parsed rows from R2.
 */
async function handlePersist(
	message: PersistQueueMessage,
	_env: IngestionEnv,
	storage: Storage,
	db: Database,
): Promise<void> {
	const { rowsR2Key, rowCount } = message;
	log.info("Persisting rows", { phase: "persist", rowCount, r2Key: rowsR2Key });

	const result = await storage.get(rowsR2Key);
	if (!result) {
		throw new Error(`Rows file not found in R2: ${rowsR2Key}`);
	}

	const rows: NormalizedRow[] = JSON.parse(
		new TextDecoder().decode(result.content),
	);

	// Group rows by store identifier
	const rowsByStore = new Map<string, NormalizedRow[]>();
	for (const row of rows) {
		const storeId = row.storeIdentifier || "unknown";
		if (!rowsByStore.has(storeId)) {
			rowsByStore.set(storeId, []);
		}
		rowsByStore.get(storeId)?.push(row);
	}

	// Persist rows for each store
	let totalPersisted = 0;
	let totalPriceChanges = 0;

	for (const [storeIdentifier, storeRows] of rowsByStore) {
		try {
			const persistResult = await persistRowsForStore(
				db,
				message.chainSlug,
				storeIdentifier,
				storeRows,
				"filename_code",
			);

			if (persistResult === null) {
				log.warn("Store not found", { phase: "persist", storeIdentifier });
				continue;
			}

			totalPersisted += persistResult.persisted;
			totalPriceChanges += persistResult.priceChanges;
		} catch (error) {
			log.error("Failed to persist for store", { phase: "persist", storeIdentifier }, error);
		}
	}

	log.info("Completed persist", {
		phase: "persist",
		persisted: totalPersisted,
		priceChanges: totalPriceChanges,
	});
}

/**
 * Handle parse chunked message - parse file, split into chunks, store in R2, enqueue persist.
 */
async function handleParseChunked(
	message: ParseChunkedQueueMessage,
	env: IngestionEnv,
	storage: Storage,
	db: Database,
): Promise<void> {
	const adapter = chainAdapterRegistry.getAdapter(message.chainSlug as ChainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain "${message.chainSlug}"`);
	}

	const { r2Key, file, innerFilename, chunkSize } = message;
	const filename = innerFilename || file.filename;
	log.info("Parsing file with chunking", {
		phase: "parse_chunked",
		filename,
		chunkSize,
	});

	const result = await storage.get(r2Key);
	if (!result) {
		throw new Error(`File not found in R2: ${r2Key}`);
	}

	const parseResult = await adapter.parse(result.content, filename);
	log.info("Parsed rows", {
		phase: "parse_chunked",
		validRows: parseResult.validRows,
		totalRows: parseResult.totalRows,
	});

	if (parseResult.rows.length === 0) {
		log.info("No rows to persist", { phase: "parse_chunked", filename });
		return;
	}

	// Create file record in database
	const fileId = generatePrefixedId("igf");
	const storeIdentifier =
		adapter.extractStoreIdentifier(file)?.value || "unknown";
	const totalChunks = Math.ceil(parseResult.rows.length / chunkSize);

	await db.insert(ingestionFiles).values({
		id: fileId,
		runId: message.runId,
		filename: filename,
		fileType: file.type,
		fileSize: result.content.byteLength,
		fileHash: message.hash,
		status: "processing",
		entryCount: parseResult.rows.length,
		totalChunks,
		processedChunks: 0,
		chunkSize,
		metadata: JSON.stringify({ storeIdentifier }),
	});

	// Split rows into chunks and enqueue persist messages
	const persistMessages: PersistChunkQueueMessage[] = [];

	for (let i = 0; i < totalChunks; i++) {
		const startRow = i * chunkSize;
		const endRow = Math.min(
			startRow + chunkSize - 1,
			parseResult.rows.length - 1,
		);
		const chunkRows = parseResult.rows.slice(startRow, endRow + 1);

		// Create chunk record
		const chunkId = generatePrefixedId("igc");
		const chunkR2Key = generateStorageKey(
			message.runId,
			message.chainSlug,
			`chunks/${fileId}/${i}.json`,
		);

		// Store chunk in R2
		await storage.put(chunkR2Key, JSON.stringify(chunkRows));

		// Insert chunk record
		await db.insert(ingestionChunks).values({
			id: chunkId,
			fileId,
			chunkIndex: i,
			startRow: startRow + 1, // 1-based for display
			endRow: endRow + 1,
			rowCount: chunkRows.length,
			status: "pending",
			r2Key: chunkR2Key,
		});

		// Create persist message
		persistMessages.push({
			...createMessage("persist_chunk", message.runId, message.chainSlug),
			fileId,
			chunkId,
			chunkR2Key,
			chunkIndex: i,
			rowCount: chunkRows.length,
		});
	}

	// Enqueue all persist chunk messages
	if (persistMessages.length > 0) {
		await sendBatchChunked(env.INGESTION_QUEUE, persistMessages);
	}

	// Increment processed files count for chunked files
	await incrementProcessedFiles(db, message.runId);

	log.info("Created chunks", {
		phase: "parse_chunked",
		totalChunks,
		enqueuedCount: persistMessages.length,
	});
}

/**
 * Handle persist chunk message - load chunk from R2, persist rows, update status.
 */
async function handlePersistChunk(
	message: PersistChunkQueueMessage,
	_env: IngestionEnv,
	storage: Storage,
	db: Database,
): Promise<void> {
	const { fileId, chunkId, chunkR2Key, chunkIndex, rowCount } = message;
	log.info("Persisting chunk", {
		phase: "persist_chunk",
		chunkIndex,
		rowCount,
		r2Key: chunkR2Key,
	});

	// Update chunk status to processing
	await db
		.update(ingestionChunks)
		.set({ status: "processing" })
		.where(eq(ingestionChunks.id, chunkId));

	const result = await storage.get(chunkR2Key);
	if (!result) {
		await db
			.update(ingestionChunks)
			.set({ status: "failed" })
			.where(eq(ingestionChunks.id, chunkId));
		throw new Error(`Chunk file not found in R2: ${chunkR2Key}`);
	}

	const rows: NormalizedRow[] = JSON.parse(
		new TextDecoder().decode(result.content),
	);

	// Group rows by store identifier
	const rowsByStore = new Map<string, NormalizedRow[]>();
	for (const row of rows) {
		const storeId = row.storeIdentifier || "unknown";
		if (!rowsByStore.has(storeId)) {
			rowsByStore.set(storeId, []);
		}
		rowsByStore.get(storeId)?.push(row);
	}

	// Persist rows for each store
	let totalPersisted = 0;
	let totalErrors = 0;

	for (const [storeIdentifier, storeRows] of rowsByStore) {
		try {
			const persistResult = await persistRowsForStore(
				db,
				message.chainSlug,
				storeIdentifier,
				storeRows,
				"filename_code",
			);

			if (persistResult === null) {
				log.warn("Store not found", { phase: "persist_chunk", storeIdentifier });
				totalErrors += storeRows.length;
				continue;
			}

			totalPersisted += persistResult.persisted;
		} catch (error) {
			log.error("Failed to persist for store", { phase: "persist_chunk", storeIdentifier }, error);
			totalErrors += storeRows.length;
		}
	}

	// Update chunk status
	await db
		.update(ingestionChunks)
		.set({
			status: totalErrors === 0 ? "completed" : "failed",
			persistedCount: totalPersisted,
			errorCount: totalErrors,
			processedAt: new Date(),
		})
		.where(eq(ingestionChunks.id, chunkId));

	// Update file processed chunks count
	await db
		.update(ingestionFiles)
		.set({ processedChunks: sql`${ingestionFiles.processedChunks} + 1` })
		.where(eq(ingestionFiles.id, fileId));

	// Check if all chunks are processed
	const [file] = await db
		.select()
		.from(ingestionFiles)
		.where(eq(ingestionFiles.id, fileId));

	if (file && file.processedChunks === file.totalChunks) {
		// Mark file as completed
		await db
			.update(ingestionFiles)
			.set({ status: "completed", processedAt: new Date() })
			.where(eq(ingestionFiles.id, fileId));
		log.info("File completed all chunks", { phase: "persist_chunk", fileId });

		// Update processed entries count for run
		await incrementProcessedEntries(db, message.runId, totalPersisted);

		// Check if run is complete
		try {
			await checkAndUpdateRunCompletion(db, message.runId);
		} catch (error) {
			log.error("Failed to check run completion", { phase: "persist_chunk" }, error);
		}
	}

	// Increment run error count if there were errors
	if (totalErrors > 0) {
		await incrementErrorCount(db, message.runId, totalErrors);
	}

	log.info("Chunk completed", {
		phase: "persist_chunk",
		chunkIndex,
		persisted: totalPersisted,
		errors: totalErrors,
	});
}

/**
 * Handle rerun message - re-run ingestion at run/file/chunk level.
 */
async function handleRerun(
	message: RerunQueueMessage,
	env: IngestionEnv,
	storage: Storage,
	db: Database,
): Promise<void> {
	const { originalRunId, targetType, targetId } = message;
	log.info("Re-running ingestion", {
		phase: "rerun",
		targetType,
		targetId,
		originalRunId,
	});

	// Create new run record for the rerun
	await db.insert(ingestionRuns).values({
		id: message.runId,
		chainSlug: message.chainSlug,
		source: "worker",
		status: "running",
		startedAt: new Date(),
		parentRunId: originalRunId,
		rerunType: targetType,
		rerunTargetId: targetId,
	});

	// Initialize run stats for rerun
	await initializeRunStats(db, message.runId);

	switch (targetType) {
		case "run": {
			// Re-run entire run - get all files and re-process
			const files = await db
				.select()
				.from(ingestionFiles)
				.where(eq(ingestionFiles.runId, targetId));

			log.info("Re-running files", {
				phase: "rerun",
				count: files.length,
				runId: targetId,
			});

			// For "run" type reruns, record total files
			if (files.length > 0) {
				await recordTotalFiles(db, message.runId, files.length);
			}

			for (const file of files) {
				if (file.metadata) {
					const metadata = JSON.parse(file.metadata);
					const r2Key = generateStorageKey(
						targetId,
						message.chainSlug,
						file.filename,
					);

					// Check if file still exists in R2
					const exists = await storage.exists(r2Key);
					if (!exists) {
						log.warn("File not found in R2", { phase: "rerun", r2Key });
						continue;
					}

					// Enqueue parse message for the file
					const parseMessage: ParseQueueMessage = {
						...createMessage("parse", message.runId, message.chainSlug),
						r2Key,
						file: {
							url: "",
							filename: file.filename,
							type: file.fileType as FileType,
							size: file.fileSize,
							lastModified: null,
							metadata: metadata,
						},
						innerFilename: null,
						hash: file.fileHash || "",
					};
					await env.INGESTION_QUEUE.send(parseMessage);
				}
			}
			break;
		}

		case "file": {
			// Re-run single file
			const [file] = await db
				.select()
				.from(ingestionFiles)
				.where(eq(ingestionFiles.id, targetId));

			if (!file) {
				throw new Error(`File not found: ${targetId}`);
			}

			// Get original run to find the R2 key
			const [originalRun] = await db
				.select()
				.from(ingestionRuns)
				.where(eq(ingestionRuns.id, file.runId));

			if (!originalRun) {
				throw new Error(`Original run not found: ${file.runId}`);
			}

			const r2Key = generateStorageKey(
				file.runId,
				originalRun.chainSlug,
				file.filename,
			);

			const exists = await storage.exists(r2Key);
			if (!exists) {
				throw new Error(`File not found in R2: ${r2Key}`);
			}

			const metadata = file.metadata ? JSON.parse(file.metadata) : {};

			const parseMessage: ParseQueueMessage = {
				...createMessage("parse", message.runId, message.chainSlug),
				r2Key,
				file: {
					url: "",
					filename: file.filename,
					type: file.fileType as FileType,
					size: file.fileSize,
					lastModified: null,
					metadata,
				},
				innerFilename: null,
				hash: file.fileHash || "",
			};
			await env.INGESTION_QUEUE.send(parseMessage);

			log.info("Enqueued parse for file", { phase: "rerun", targetId });
			break;
		}

		case "chunk": {
			// Re-run single chunk
			const [chunk] = await db
				.select()
				.from(ingestionChunks)
				.where(eq(ingestionChunks.id, targetId));

			if (!chunk) {
				throw new Error(`Chunk not found: ${targetId}`);
			}

			if (!chunk.r2Key) {
				throw new Error(`Chunk has no R2 key: ${targetId}`);
			}

			const exists = await storage.exists(chunk.r2Key);
			if (!exists) {
				throw new Error(`Chunk file not found in R2: ${chunk.r2Key}`);
			}

			// Reset chunk status
			await db
				.update(ingestionChunks)
				.set({ status: "pending", persistedCount: 0, errorCount: 0 })
				.where(eq(ingestionChunks.id, targetId));

			const persistMessage: PersistChunkQueueMessage = {
				...createMessage("persist_chunk", message.runId, message.chainSlug),
				fileId: chunk.fileId,
				chunkId: chunk.id,
				chunkR2Key: chunk.r2Key,
				chunkIndex: chunk.chunkIndex,
				rowCount: chunk.rowCount,
			};
			await env.INGESTION_QUEUE.send(persistMessage);

			log.info("Enqueued persist for chunk", { phase: "rerun", targetId });
			break;
		}

		default:
			throw new Error(`Unknown rerun target type: ${targetType}`);
	}
}

/**
 * Handle enrich store message - call geocoding API, save results.
 */
async function handleEnrichStore(
	message: EnrichStoreQueueMessage,
	_env: IngestionEnv,
	_storage: Storage,
	db: Database,
): Promise<void> {
	const { storeId, taskType, taskId } = message;
	log.info("Enriching store", { phase: "enrich_store", storeId, taskType });

	// Update task status to processing
	await db
		.update(storeEnrichmentTasks)
		.set({ status: "processing" })
		.where(eq(storeEnrichmentTasks.id, taskId));

	// Get store data
	const [store] = await db.select().from(stores).where(eq(stores.id, storeId));

	if (!store) {
		await db
			.update(storeEnrichmentTasks)
			.set({ status: "failed", errorMessage: "Store not found" })
			.where(eq(storeEnrichmentTasks.id, taskId));
		throw new Error(`Store not found: ${storeId}`);
	}

	try {
		switch (taskType) {
			case "geocode": {
				// Use the geocoding service
				const geocodeResult = await geocodeAddress({
					address: store.address,
					city: store.city,
					postalCode: store.postalCode,
					country: "hr",
				});

				if (!geocodeResult.found) {
					await db
						.update(storeEnrichmentTasks)
						.set({
							status: "completed",
							outputData: JSON.stringify({ found: false }),
							confidence: geocodeResult.confidence,
							updatedAt: new Date(),
						})
						.where(eq(storeEnrichmentTasks.id, taskId));
					log.info("No geocoding results", { phase: "enrich_store", storeId });
					return;
				}

				// Auto-verify high confidence results
				const isHighConfidence = geocodeResult.confidence === "high";

				if (isHighConfidence) {
					// High confidence: apply coordinates directly to store
					await db
						.update(stores)
						.set({
							latitude: geocodeResult.latitude!,
							longitude: geocodeResult.longitude!,
							updatedAt: new Date(),
						})
						.where(eq(stores.id, storeId));
				}

				// Update task as completed (auto-verified if high confidence)
				await db
					.update(storeEnrichmentTasks)
					.set({
						status: "completed",
						outputData: JSON.stringify({
							found: true,
							lat: geocodeResult.latitude,
							lon: geocodeResult.longitude,
							displayName: geocodeResult.displayName,
							provider: geocodeResult.provider,
							autoVerified: isHighConfidence,
						}),
						confidence: geocodeResult.confidence,
						// Auto-verify high confidence results
						...(isHighConfidence && {
							verifiedAt: new Date(),
							verifiedBy: "system",
						}),
						updatedAt: new Date(),
					})
					.where(eq(storeEnrichmentTasks.id, taskId));

				log.info("Geocoded store", {
					phase: "enrich_store",
					storeId,
					latitude: geocodeResult.latitude,
					longitude: geocodeResult.longitude,
					confidence: geocodeResult.confidence,
					autoVerified: isHighConfidence,
				});
				break;
			}

			case "verify_address": {
				// Address verification logic - could use a different API
				// For now, just mark as pending verification
				await db
					.update(storeEnrichmentTasks)
					.set({
						status: "completed",
						outputData: JSON.stringify({
							originalAddress: store.address,
							city: store.city,
							postalCode: store.postalCode,
							needsReview: true,
						}),
						confidence: "medium",
						updatedAt: new Date(),
					})
					.where(eq(storeEnrichmentTasks.id, taskId));

				log.info("Address verification pending", { phase: "enrich_store", storeId });
				break;
			}

			case "ai_categorize": {
				// AI categorization - placeholder for future implementation
				await db
					.update(storeEnrichmentTasks)
					.set({
						status: "completed",
						outputData: JSON.stringify({
							message: "AI categorization not yet implemented",
						}),
						confidence: "low",
						updatedAt: new Date(),
					})
					.where(eq(storeEnrichmentTasks.id, taskId));

				log.info("AI categorization not implemented", { phase: "enrich_store" });
				break;
			}

			default:
				throw new Error(`Unknown enrichment task type: ${taskType}`);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		await db
			.update(storeEnrichmentTasks)
			.set({
				status: "failed",
				errorMessage,
				updatedAt: new Date(),
			})
			.where(eq(storeEnrichmentTasks.id, taskId));
		throw error;
	}
}

// ============================================================================
// Queue Handler
// ============================================================================

/**
 * Process a single queue message.
 */
async function processMessage(
	message: Message<QueueMessage>,
	env: IngestionEnv,
	storage: Storage,
	db: Database,
): Promise<void> {
	const msg = message.body;
	log.info("Processing message", { phase: "queue", type: msg.type, messageId: msg.id });

	try {
		if (isDiscoverMessage(msg)) {
			await handleDiscover(msg, env, storage, db);
		} else if (isFetchMessage(msg)) {
			await handleFetch(msg, env, storage, db);
		} else if (isExpandMessage(msg)) {
			await handleExpand(msg, env, storage, db);
		} else if (isParseMessage(msg)) {
			await handleParse(msg, env, storage, db);
		} else if (isPersistMessage(msg)) {
			await handlePersist(msg, env, storage, db);
		} else if (isParseChunkedMessage(msg)) {
			await handleParseChunked(msg, env, storage, db);
		} else if (isPersistChunkMessage(msg)) {
			await handlePersistChunk(msg, env, storage, db);
		} else if (isRerunMessage(msg)) {
			await handleRerun(msg, env, storage, db);
		} else if (isEnrichStoreMessage(msg)) {
			await handleEnrichStore(msg, env, storage, db);
		} else {
			throw new Error(`Unknown message type: ${(msg as QueueMessage).type}`);
		}

		message.ack();
		log.info("Completed message", { phase: "queue", type: msg.type, messageId: msg.id });
	} catch (error) {
		const maxRetries = getMaxRetries(env);
		const errorMessage = error instanceof Error ? error.message : String(error);

		log.error("Failed message", {
			phase: "queue",
			type: msg.type,
			attempt: message.attempts,
			maxRetries,
			errorMessage,
		});

		if (message.attempts >= maxRetries) {
			// Mark run as failed if this is a critical failure
			if (isDiscoverMessage(msg) || isParseMessage(msg) || isParseChunkedMessage(msg)) {
				try {
					await markRunFailed(
						db,
						msg.runId,
						`Failed after ${message.attempts} attempts: ${errorMessage}`,
					);
				} catch (statsError) {
					log.error("Failed to mark run as failed", { phase: "queue" }, statsError);
				}
			}
			// Send to dead letter queue if available
			if (env.INGESTION_DLQ) {
				await env.INGESTION_DLQ.send(msg);
				log.info("Sent to DLQ", { phase: "queue", messageId: msg.id });
			}
			message.ack(); // Don't retry anymore
		} else {
			// Retry with exponential backoff
			const delaySeconds = Math.min(60 * 2 ** (message.attempts - 1), 3600);
			message.retry({ delaySeconds });
			log.info("Retrying message", { phase: "queue", delaySeconds, messageId: msg.id });
		}
	}
}

/**
 * Queue consumer handler.
 * Processes batches of queue messages.
 */
export async function queue(
	batch: MessageBatch<QueueMessage>,
	env: IngestionEnv,
	_ctx: ExecutionContext,
): Promise<void> {
	// Adapters are pre-registered via centralized initialization

	// Cast to any to satisfy R2Storage's internal R2Bucket interface
	// The global R2Bucket type is structurally compatible
	const storage = new R2Storage(env.INGESTION_BUCKET as any);
	const db = createDb(env.DB);

	log.info("Processing batch", {
		phase: "queue",
		messageCount: batch.messages.length,
		queue: batch.queue,
	});

	// Process messages in parallel with concurrency limit
	const CONCURRENCY_LIMIT = 5;
	const messages = [...batch.messages];

	while (messages.length > 0) {
		const chunk = messages.splice(0, CONCURRENCY_LIMIT);
		await Promise.all(
			chunk.map((message) => processMessage(message, env, storage, db)),
		);
	}

	log.info("Batch completed", { phase: "queue" });
}

// ============================================================================
// Scheduled Handler
// ============================================================================

/**
 * Scheduled handler for periodic ingestion runs.
 * Triggers discover+fetch for configured chains.
 */
export async function scheduled(
	controller: ScheduledController,
	env: IngestionEnv,
	_ctx: ExecutionContext,
): Promise<void> {
	// Adapters are pre-registered via centralized initialization

	const runId = generatePrefixedId("run");
	const chains = getConfiguredChains(env);
	const date = getTodayDate();

	log.info("Starting ingestion run", {
		phase: "scheduled",
		runId,
		chainCount: chains.length,
		date,
		cron: controller.cron,
	});

	// Enqueue discover messages for each chain
	const discoverMessages: DiscoverQueueMessage[] = chains.map((chainSlug) => ({
		...createMessage("discover", runId, chainSlug),
	}));

	await sendBatchChunked(env.INGESTION_QUEUE, discoverMessages);

	log.info("Enqueued discover messages", {
		phase: "scheduled",
		count: discoverMessages.length,
	});
}

// ============================================================================
// HTTP Handler (for manual triggers and health checks)
// ============================================================================

/**
 * HTTP handler for manual triggers and health checks.
 */
export async function fetch(
	request: Request,
	env: IngestionEnv,
	_ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);

	// Health check
	if (url.pathname === "/health") {
		return new Response(JSON.stringify({ status: "ok" }), {
			headers: { "Content-Type": "application/json" },
		});
	}

	// Manual trigger endpoint
	if (url.pathname === "/trigger" && request.method === "POST") {
		// Adapters are pre-registered via centralized initialization

		const runId = generatePrefixedId("run");
		const chainParam = url.searchParams.get("chain");

		let chains: ChainId[];
		if (chainParam && isValidChainId(chainParam)) {
			chains = [chainParam];
		} else {
			chains = getConfiguredChains(env);
		}

		log.info("Manual trigger", {
			phase: "trigger",
			chainCount: chains.length,
			chains: chains.join(", "),
		});

		// Enqueue discover messages
		const discoverMessages: DiscoverQueueMessage[] = chains.map(
			(chainSlug) => ({
				...createMessage("discover", runId, chainSlug),
			}),
		);

		await sendBatchChunked(env.INGESTION_QUEUE, discoverMessages);

		return new Response(
			JSON.stringify({
				status: "ok",
				runId,
				chains,
				messagesEnqueued: discoverMessages.length,
			}),
			{
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	return new Response("Not Found", { status: 404 });
}

// ============================================================================
// Default Export
// ============================================================================

export default {
	fetch,
	queue,
	scheduled,
} satisfies ExportedHandler<IngestionEnv, QueueMessage>;
