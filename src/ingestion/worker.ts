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

	console.log(`[discover] Starting discovery for ${adapter.name}`);

	const files = await adapter.discover();
	console.log(`[discover] Found ${files.length} file(s) for ${adapter.name}`);

	// Initialize run stats and record total files
	await initializeRunStats(db, message.runId);
	if (files.length > 0) {
		await recordTotalFiles(db, message.runId, files.length);
	}

	if (files.length === 0) {
		return;
	}

	// Enqueue fetch messages for each file
	const fetchMessages: FetchQueueMessage[] = files.map((file) => ({
		...createMessage("fetch", message.runId, message.chainSlug),
		file,
	}));

	await sendBatchChunked(env.INGESTION_QUEUE, fetchMessages);

	console.log(`[discover] Enqueued ${fetchMessages.length} fetch message(s)`);
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
	console.log(`[fetch] Fetching ${file.filename} from ${adapter.name}`);

	const fetched = await adapter.fetch(file);
	const r2Key = generateStorageKey(
		message.runId,
		message.chainSlug,
		file.filename,
	);

	// Check for duplicate by hash
	const existing = await storage.head(r2Key);
	if (existing?.sha256 === fetched.hash) {
		console.log(`[fetch] Skipped duplicate: ${file.filename}`);
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

	console.log(
		`[fetch] Stored ${file.filename} (${fetched.content.byteLength} bytes)`,
	);

	// Determine next step based on file type
	if (file.type === "zip") {
		// Enqueue expand message for ZIP files
		const expandMessage: ExpandQueueMessage = {
			...createMessage("expand", message.runId, message.chainSlug),
			r2Key,
			file,
		};
		await env.INGESTION_QUEUE.send(expandMessage);
		console.log(`[fetch] Enqueued expand message for ${file.filename}`);
	} else {
		// Enqueue parse message for non-ZIP files
		const parseMessage: ParseQueueMessage = {
			...createMessage("parse", message.runId, message.chainSlug),
			r2Key,
			file,
			innerFilename: null,
			hash: fetched.hash,
		};
		await env.INGESTION_QUEUE.send(parseMessage);
		console.log(`[fetch] Enqueued parse message for ${file.filename}`);
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
	console.log(`[expand] Expanding ${file.filename}`);

	const result = await storage.get(r2Key);
	if (!result) {
		throw new Error(`ZIP file not found in R2: ${r2Key}`);
	}

	const uint8Content = new Uint8Array(result.content);
	const unzipped = unzipSync(uint8Content);

	const parseMessages: ParseQueueMessage[] = [];
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

		parseMessages.push({
			...createMessage("parse", message.runId, message.chainSlug),
			r2Key: expandedKey,
			file: expandedFile,
			innerFilename,
			hash: innerHash,
		});

		expandedCount++;
	}

	if (parseMessages.length > 0) {
		await sendBatchChunked(env.INGESTION_QUEUE, parseMessages);
	}

	console.log(
		`[expand] Expanded ${expandedCount} file(s), enqueued ${parseMessages.length} parse message(s)`,
	);
}

/**
 * Handle parse message - parse file and persist to database.
 */
async function handleParse(
	message: ParseQueueMessage,
	_env: IngestionEnv,
	storage: Storage,
	db: Database,
): Promise<void> {
	const adapter = chainAdapterRegistry.getAdapter(message.chainSlug as ChainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain "${message.chainSlug}"`);
	}

	const { r2Key, file, innerFilename } = message;
	const filename = innerFilename || file.filename;
	console.log(`[parse] Parsing ${filename} from ${adapter.name}`);

	const result = await storage.get(r2Key);
	if (!result) {
		throw new Error(`File not found in R2: ${r2Key}`);
	}

	const parseResult = await adapter.parse(result.content, filename);
	console.log(
		`[parse] Parsed ${parseResult.validRows}/${parseResult.totalRows} valid rows`,
	);

	if (parseResult.errors.length > 0) {
		console.warn(`[parse] ${parseResult.errors.length} parse error(s)`);
	}

	if (parseResult.rows.length === 0) {
		console.log(`[parse] No rows to persist for ${filename}`);
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
				console.warn(`[parse] Failed to register store "${storeIdentifier}"`);
				continue;
			}

			totalPersisted += persistResult.persisted;
			totalPriceChanges += persistResult.priceChanges;
		} catch (error) {
			console.error(
				`[parse] Failed to persist for store "${storeIdentifier}":`,
				error,
			);
		}
	}

	console.log(
		`[parse] Persisted ${totalPersisted} rows, ${totalPriceChanges} price changes`,
	);
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
	console.log(`[persist] Persisting ${rowCount} rows from ${rowsR2Key}`);

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
				console.warn(`[persist] Store not found: "${storeIdentifier}"`);
				continue;
			}

			totalPersisted += persistResult.persisted;
			totalPriceChanges += persistResult.priceChanges;
		} catch (error) {
			console.error(
				`[persist] Failed to persist for store "${storeIdentifier}":`,
				error,
			);
		}
	}

	console.log(
		`[persist] Completed: ${totalPersisted} persisted, ${totalPriceChanges} price changes`,
	);
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
	console.log(
		`[parse_chunked] Parsing ${filename} with chunk size ${chunkSize}`,
	);

	const result = await storage.get(r2Key);
	if (!result) {
		throw new Error(`File not found in R2: ${r2Key}`);
	}

	const parseResult = await adapter.parse(result.content, filename);
	console.log(
		`[parse_chunked] Parsed ${parseResult.validRows}/${parseResult.totalRows} valid rows`,
	);

	if (parseResult.rows.length === 0) {
		console.log(`[parse_chunked] No rows to persist for ${filename}`);
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

	console.log(
		`[parse_chunked] Created ${totalChunks} chunk(s), enqueued persist messages`,
	);
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
	console.log(
		`[persist_chunk] Persisting chunk ${chunkIndex} (${rowCount} rows) from ${chunkR2Key}`,
	);

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
				console.warn(`[persist_chunk] Store not found: "${storeIdentifier}"`);
				totalErrors += storeRows.length;
				continue;
			}

			totalPersisted += persistResult.persisted;
		} catch (error) {
			console.error(
				`[persist_chunk] Failed to persist for store "${storeIdentifier}":`,
				error,
			);
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
		console.log(`[persist_chunk] File ${fileId} completed all chunks`);

		// Update processed entries count for run
		await incrementProcessedEntries(db, message.runId, totalPersisted);

		// Check if run is complete
		try {
			await checkAndUpdateRunCompletion(db, message.runId);
		} catch (error) {
			console.error(`[persist_chunk] Failed to check run completion:`, error);
		}
	}

	// Increment run error count if there were errors
	if (totalErrors > 0) {
		await incrementErrorCount(db, message.runId, totalErrors);
	}

	console.log(
		`[persist_chunk] Chunk ${chunkIndex} completed: ${totalPersisted} persisted, ${totalErrors} errors`,
	);
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
	console.log(
		`[rerun] Re-running ${targetType} ${targetId} from run ${originalRunId}`,
	);

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

			console.log(
				`[rerun] Re-running ${files.length} file(s) from run ${targetId}`,
			);

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
						console.warn(`[rerun] File not found in R2: ${r2Key}, skipping`);
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

			console.log(`[rerun] Enqueued parse for file ${targetId}`);
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

			console.log(`[rerun] Enqueued persist for chunk ${targetId}`);
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
	console.log(`[enrich_store] Enriching store ${storeId} with ${taskType}`);

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
					console.log(
						`[enrich_store] No geocoding results for store ${storeId}`,
					);
					return;
				}

				// Update store with geocoded coordinates
				await db
					.update(stores)
					.set({
						latitude: geocodeResult.latitude!,
						longitude: geocodeResult.longitude!,
						updatedAt: new Date(),
					})
					.where(eq(stores.id, storeId));

				// Update task as completed
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
						}),
						confidence: geocodeResult.confidence,
						updatedAt: new Date(),
					})
					.where(eq(storeEnrichmentTasks.id, taskId));

				console.log(
					`[enrich_store] Geocoded store ${storeId} -> ${geocodeResult.latitude}, ${geocodeResult.longitude} (${geocodeResult.confidence} confidence)`,
				);
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

				console.log(
					`[enrich_store] Address verification pending for store ${storeId}`,
				);
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

				console.log(`[enrich_store] AI categorization not yet implemented`);
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
	console.log(`[queue] Processing ${msg.type} message: ${msg.id}`);

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
		console.log(`[queue] Completed ${msg.type} message: ${msg.id}`);
	} catch (error) {
		const maxRetries = getMaxRetries(env);
		const errorMessage = error instanceof Error ? error.message : String(error);

		console.error(
			`[queue] Failed ${msg.type} message (attempt ${message.attempts}/${maxRetries}): ${errorMessage}`,
		);

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
					console.error(`[queue] Failed to mark run as failed:`, statsError);
				}
			}
			// Send to dead letter queue if available
			if (env.INGESTION_DLQ) {
				await env.INGESTION_DLQ.send(msg);
				console.log(`[queue] Sent to DLQ: ${msg.id}`);
			}
			message.ack(); // Don't retry anymore
		} else {
			// Retry with exponential backoff
			const delaySeconds = Math.min(60 * 2 ** (message.attempts - 1), 3600);
			message.retry({ delaySeconds });
			console.log(`[queue] Retrying in ${delaySeconds}s: ${msg.id}`);
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

	console.log(
		`[queue] Processing batch of ${batch.messages.length} message(s) from ${batch.queue}`,
	);

	// Process messages in parallel with concurrency limit
	const CONCURRENCY_LIMIT = 5;
	const messages = [...batch.messages];

	while (messages.length > 0) {
		const chunk = messages.splice(0, CONCURRENCY_LIMIT);
		await Promise.all(
			chunk.map((message) => processMessage(message, env, storage, db)),
		);
	}

	console.log(`[queue] Batch completed`);
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

	console.log(
		`[scheduled] Starting ingestion run ${runId} for ${chains.length} chain(s) on ${date}`,
	);
	console.log(`[scheduled] Cron: ${controller.cron}`);

	// Enqueue discover messages for each chain
	const discoverMessages: DiscoverQueueMessage[] = chains.map((chainSlug) => ({
		...createMessage("discover", runId, chainSlug),
	}));

	await sendBatchChunked(env.INGESTION_QUEUE, discoverMessages);

	console.log(
		`[scheduled] Enqueued ${discoverMessages.length} discover message(s)`,
	);
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

		console.log(
			`[trigger] Manual trigger for ${chains.length} chain(s): ${chains.join(", ")}`,
		);

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
