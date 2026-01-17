/**
 * Ingestion Processor
 *
 * Extracted processing logic from Cloudflare Workers queue handler.
 * This module provides direct function calls for ingestion operations,
 * suitable for Node.js execution via Bree workers or API calls.
 */

import { eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { getDatabase, type DatabaseType } from "@/db";
import {
	chains,
	ingestionChunks,
	ingestionFiles,
	ingestionRuns,
	storeEnrichmentTasks,
	stores,
} from "@/db/schema";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";
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
	createStorage,
	generateStorageKey,
	type Storage,
} from "./core/storage";
import type {
	DiscoveredFile,
	FileType,
	NormalizedRow,
} from "./core/types";
import { geocodeAddress } from "./services/geocoding";

const log = createLogger("ingestion");

// ============================================================================
// Types
// ============================================================================

export interface IngestionContext {
	db: DatabaseType;
	storage: Storage;
}

export interface IngestionResult {
	success: boolean;
	runId: string;
	filesProcessed: number;
	entriesPersisted: number;
	errors: string[];
}

// ============================================================================
// Utility Functions
// ============================================================================

function getTodayDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

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

function getConfiguredChains(): ChainId[] {
	const chainsEnv = process.env.INGESTION_CHAINS;
	if (!chainsEnv) {
		return [...CHAIN_IDS];
	}

	const configured = chainsEnv
		.split(",")
		.map((s) => s.trim())
		.filter(isValidChainId);

	return configured.length > 0 ? configured : [...CHAIN_IDS];
}

// ============================================================================
// Discovery Phase
// ============================================================================

export async function discoverPrices(
	chainId: ChainId,
	ctx: IngestionContext,
	runId: string,
	targetDate?: string,
): Promise<DiscoveredFile[]> {
	const adapter = chainAdapterRegistry.getAdapter(chainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain "${chainId}"`);
	}

	log.info("Starting discovery", { phase: "discover", adapter: adapter.name });

	// Set discovery date if provided and adapter supports it
	if (
		targetDate &&
		"setDiscoveryDate" in adapter &&
		typeof adapter.setDiscoveryDate === "function"
	) {
		(adapter.setDiscoveryDate as (date: string) => void)(targetDate);
		log.info("Set discovery date", { phase: "discover", targetDate });
	}

	const files = await adapter.discover();
	log.info("Discovery complete", {
		phase: "discover",
		count: files.length,
		adapter: adapter.name,
		runId,
	});

	// Initialize run stats and record total files
	await initializeRunStats(ctx.db, runId);
	await recordTotalFiles(ctx.db, runId, files.length);

	if (files.length === 0) {
		log.warn("No files discovered", {
			phase: "discover",
			adapter: adapter.name,
			reason: "no_files_available",
		});

		// Mark run as completed with 0 files
		await ctx.db
			.update(ingestionRuns)
			.set({
				status: "completed",
				completedAt: new Date(),
				totalFiles: 0,
				processedFiles: 0,
			})
			.where(eq(ingestionRuns.id, runId));
	}

	return files;
}

// ============================================================================
// Fetch Phase
// ============================================================================

export async function fetchPriceFile(
	chainId: ChainId,
	file: DiscoveredFile,
	ctx: IngestionContext,
	runId: string,
): Promise<{ r2Key: string; hash: string; isZip: boolean } | null> {
	const adapter = chainAdapterRegistry.getAdapter(chainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain "${chainId}"`);
	}

	log.info("Fetching file", {
		phase: "fetch",
		filename: file.filename,
		adapter: adapter.name,
	});

	const fetched = await adapter.fetch(file);
	const storageKey = generateStorageKey(runId, chainId, file.filename);

	// Check for duplicate by hash
	const existing = await ctx.storage.head(storageKey);
	if (existing?.sha256 === fetched.hash) {
		log.info("Skipped duplicate file", { phase: "fetch", filename: file.filename });
		return null;
	}

	// Store in storage
	await ctx.storage.put(storageKey, fetched.content, {
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

	return {
		r2Key: storageKey,
		hash: fetched.hash,
		isZip: file.type === "zip",
	};
}

// ============================================================================
// Expand Phase
// ============================================================================

export interface ExpandedFile {
	storageKey: string;
	filename: string;
	type: FileType;
	hash: string;
	size: number;
}

export async function expandZipFile(
	storageKey: string,
	file: DiscoveredFile,
	ctx: IngestionContext,
	runId: string,
	chainId: string,
): Promise<ExpandedFile[]> {
	log.info("Expanding file", { phase: "expand", filename: file.filename });

	const result = await ctx.storage.get(storageKey);
	if (!result) {
		throw new Error(`ZIP file not found in storage: ${storageKey}`);
	}

	const uint8Content = new Uint8Array(result.content);
	const unzipped = unzipSync(uint8Content);

	const expandedFiles: ExpandedFile[] = [];

	for (const [innerFilename, innerContent] of Object.entries(unzipped)) {
		// Skip directories and hidden files
		if (innerFilename.endsWith("/") || innerFilename.startsWith("__MACOSX")) {
			continue;
		}

		const innerType = detectFileType(innerFilename);
		const innerHash = await computeSha256(innerContent);

		// Store expanded file
		const expandedKey = generateStorageKey(
			runId,
			chainId,
			`expanded/${file.filename}/${innerFilename}`,
		);

		await ctx.storage.put(expandedKey, innerContent, {
			sha256: innerHash,
			customMetadata: {
				parentFilename: file.filename,
				innerFilename,
				type: innerType,
			},
		});

		expandedFiles.push({
			storageKey: expandedKey,
			filename: innerFilename,
			type: innerType,
			hash: innerHash,
			size: innerContent.byteLength,
		});
	}

	log.info("Expanded files", {
		phase: "expand",
		expandedCount: expandedFiles.length,
	});

	return expandedFiles;
}

// ============================================================================
// Parse Phase
// ============================================================================

export interface ParsedData {
	fileId: string;
	rowsByStore: Map<string, NormalizedRow[]>;
	totalRows: number;
	validRows: number;
}

export async function parsePriceFile(
	chainId: ChainId,
	storageKey: string,
	filename: string,
	hash: string,
	file: DiscoveredFile,
	ctx: IngestionContext,
	runId: string,
): Promise<ParsedData | null> {
	const adapter = chainAdapterRegistry.getAdapter(chainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain "${chainId}"`);
	}

	log.info("Parsing file", { phase: "parse", filename, adapter: adapter.name });

	const result = await ctx.storage.get(storageKey);
	if (!result) {
		throw new Error(`File not found in storage: ${storageKey}`);
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

	await ctx.db.insert(ingestionFiles).values({
		id: fileId,
		runId,
		filename,
		fileType: file.type,
		fileSize: result.content.byteLength,
		fileHash: hash,
		status: "processing",
		entryCount: parseResult.rows.length,
		totalChunks: 1,
		processedChunks: 0,
		chunkSize: parseResult.rows.length,
		metadata: JSON.stringify({ storeIdentifier }),
	});

	if (parseResult.rows.length === 0) {
		log.info("No rows to persist", { phase: "parse", filename });
		await ctx.db
			.update(ingestionFiles)
			.set({ status: "completed", processedChunks: 1, processedAt: new Date() })
			.where(eq(ingestionFiles.id, fileId));
		return null;
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

	return {
		fileId,
		rowsByStore,
		totalRows: parseResult.totalRows,
		validRows: parseResult.validRows,
	};
}

// ============================================================================
// Persist Phase
// ============================================================================

export async function persistParsedData(
	chainId: ChainId,
	fileId: string,
	parsedData: ParsedData,
	file: DiscoveredFile,
	ctx: IngestionContext,
	runId: string,
): Promise<{ persisted: number; priceChanges: number }> {
	const adapter = chainAdapterRegistry.getAdapter(chainId);

	// Extract store metadata for auto-registration
	const storeMetadata = adapter?.extractStoreMetadata?.(file);

	let totalPersisted = 0;
	let totalPriceChanges = 0;

	for (const [storeIdentifier, rows] of parsedData.rowsByStore) {
		try {
			// Build autoRegister options from store metadata
			const autoRegisterOptions = storeMetadata
				? {
						name: storeMetadata.name,
						address: storeMetadata.address,
						city: storeMetadata.city,
					}
				: {
						name: `${adapter?.name || chainId} Store ${storeIdentifier}`,
					};

			const persistResult = await persistRowsForStore(
				ctx.db,
				chainId,
				storeIdentifier,
				rows,
				"filename_code",
				autoRegisterOptions,
			);

			if (persistResult === null) {
				log.warn("Failed to register store", { phase: "persist", storeIdentifier });
				continue;
			}

			totalPersisted += persistResult.persisted;
			totalPriceChanges += persistResult.priceChanges;

			// Auto-trigger geocoding for new pending stores with address data
			if (persistResult.needsGeocoding && persistResult.storeId) {
				const taskId = generatePrefixedId("set");
				await ctx.db.insert(storeEnrichmentTasks).values({
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

				// Trigger geocoding directly instead of via queue
				try {
					await processEnrichStore(
						persistResult.storeId,
						"geocode",
						taskId,
						ctx,
					);
				} catch (error) {
					log.error("Geocoding failed", { storeIdentifier, error });
				}
			}
		} catch (error) {
			log.error("Failed to persist for store", { phase: "persist", storeIdentifier }, error);
		}
	}

	log.info("Persisted rows", {
		phase: "persist",
		persisted: totalPersisted,
		priceChanges: totalPriceChanges,
	});

	// Mark file as completed
	await ctx.db
		.update(ingestionFiles)
		.set({
			status: "completed",
			processedChunks: 1,
			processedAt: new Date(),
		})
		.where(eq(ingestionFiles.id, fileId));

	// Update run progress
	await incrementProcessedFiles(ctx.db, runId);
	await incrementProcessedEntries(ctx.db, runId, totalPersisted);

	// Check if run is complete
	try {
		await checkAndUpdateRunCompletion(ctx.db, runId);
	} catch (error) {
		log.error("Failed to check run completion", { phase: "persist" }, error);
	}

	return { persisted: totalPersisted, priceChanges: totalPriceChanges };
}

// ============================================================================
// Store Enrichment
// ============================================================================

export async function processEnrichStore(
	storeId: string,
	taskType: "geocode" | "verify_address" | "ai_categorize",
	taskId: string,
	ctx: IngestionContext,
): Promise<void> {
	log.info("Enriching store", { phase: "enrich_store", storeId, taskType });

	// Update task status to processing
	await ctx.db
		.update(storeEnrichmentTasks)
		.set({ status: "processing" })
		.where(eq(storeEnrichmentTasks.id, taskId));

	// Get store data
	const [store] = await ctx.db.select().from(stores).where(eq(stores.id, storeId));

	if (!store) {
		await ctx.db
			.update(storeEnrichmentTasks)
			.set({ status: "failed", errorMessage: "Store not found" })
			.where(eq(storeEnrichmentTasks.id, taskId));
		throw new Error(`Store not found: ${storeId}`);
	}

	try {
		switch (taskType) {
			case "geocode": {
				const geocodeResult = await geocodeAddress({
					address: store.address,
					city: store.city,
					postalCode: store.postalCode,
					country: "hr",
				});

				if (!geocodeResult.found) {
					await ctx.db
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

				const isHighConfidence = geocodeResult.confidence === "high";

				if (isHighConfidence) {
					await ctx.db
						.update(stores)
						.set({
							latitude: geocodeResult.latitude!,
							longitude: geocodeResult.longitude!,
							updatedAt: new Date(),
						})
						.where(eq(stores.id, storeId));
				}

				await ctx.db
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
				await ctx.db
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
				await ctx.db
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
		await ctx.db
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
// Full Pipeline Execution
// ============================================================================

/**
 * Run the complete ingestion pipeline for specified chains.
 * This is called by the Bree worker or can be triggered manually via API.
 */
export async function runIngestionPipeline(
	chainIds?: ChainId[],
	targetDate?: string,
): Promise<IngestionResult[]> {
	const db = getDatabase();
	const storage = createStorage();
	const ctx: IngestionContext = { db, storage };

	const chainsToProcess = chainIds || getConfiguredChains();
	const results: IngestionResult[] = [];

	for (const chainId of chainsToProcess) {
		const runId = generatePrefixedId("run");
		const errors: string[] = [];
		let filesProcessed = 0;
		let entriesPersisted = 0;

		try {
			log.info("Starting ingestion run", {
				runId,
				chainId,
				date: targetDate || getTodayDate(),
			});

			// Ensure chain exists in database
			const chainConfig = chainAdapterRegistry.getAdapter(chainId);
			if (chainConfig) {
				await db
					.insert(chains)
					.values({
						slug: chainId,
						name: chainConfig.name,
						website: "",
					})
					.onConflictDoNothing();
			}

			// Create run record
			await db.insert(ingestionRuns).values({
				id: runId,
				chainSlug: chainId,
				source: "worker",
				status: "running",
				startedAt: new Date(),
			});

			// Phase 1: Discover
			const discoveredFiles = await discoverPrices(chainId, ctx, runId, targetDate);

			// Phase 2-5: Process each file
			for (const file of discoveredFiles) {
				try {
					// Fetch
					const fetchResult = await fetchPriceFile(chainId, file, ctx, runId);
					if (!fetchResult) continue; // Duplicate, skip

					let filesToParse: Array<{
						storageKey: string;
						filename: string;
						hash: string;
						file: DiscoveredFile;
					}>;

					if (fetchResult.isZip) {
						// Expand
						const expanded = await expandZipFile(
							fetchResult.r2Key,
							file,
							ctx,
							runId,
							chainId,
						);
						filesToParse = expanded.map((ef) => ({
							storageKey: ef.storageKey,
							filename: ef.filename,
							hash: ef.hash,
							file: { ...file, filename: ef.filename, type: ef.type, size: ef.size },
						}));
					} else {
						filesToParse = [
							{
								storageKey: fetchResult.r2Key,
								filename: file.filename,
								hash: fetchResult.hash,
								file,
							},
						];
					}

					for (const fileToParse of filesToParse) {
						// Parse
						const parsedData = await parsePriceFile(
							chainId,
							fileToParse.storageKey,
							fileToParse.filename,
							fileToParse.hash,
							fileToParse.file,
							ctx,
							runId,
						);

						if (parsedData) {
							// Persist
							const { persisted, priceChanges } = await persistParsedData(
								chainId,
								parsedData.fileId,
								parsedData,
								fileToParse.file,
								ctx,
								runId,
							);
							entriesPersisted += persisted;
						}

						filesProcessed++;
					}
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					errors.push(`${file.filename}: ${msg}`);
					log.error("Failed to process file", { filename: file.filename, error: msg });
				}
			}

			// Mark run as completed
			await db
				.update(ingestionRuns)
				.set({
					status: errors.length > 0 ? "completed" : "completed",
					completedAt: new Date(),
				})
				.where(eq(ingestionRuns.id, runId));

			results.push({
				success: true,
				runId,
				filesProcessed,
				entriesPersisted,
				errors,
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			errors.push(msg);
			log.error("Ingestion run failed", { runId, chainId, error: msg });

			try {
				await markRunFailed(db, runId, msg);
			} catch {
				// Ignore error marking run as failed
			}

			results.push({
				success: false,
				runId,
				filesProcessed,
				entriesPersisted,
				errors,
			});
		}
	}

	return results;
}

/**
 * Trigger ingestion for a single chain.
 * Convenience function for API endpoints.
 */
export async function triggerIngestion(
	chainId: ChainId,
	targetDate?: string,
): Promise<IngestionResult> {
	const results = await runIngestionPipeline([chainId], targetDate);
	return results[0];
}
