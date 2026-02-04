import { and, eq, inArray } from "drizzle-orm";
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
import { type ParquetPriceRow, writePricesParquet } from "@/ingestion/parquet";
import type {
	DiscoveredFile,
	NormalizedRow,
	ParseResult,
} from "@/ingestion/types";
import {
	buildArchiveKey,
	buildExpandedKey,
	buildParquetKey,
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
): Promise<string> {
	const cached = cache.get(storeIdentifier);
	if (cached) {
		return cached;
	}

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
		cache.set(storeIdentifier, existing[0].id);
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

	cache.set(storeIdentifier, storeId);
	return storeId;
}

async function findRetailerItemByExternalId(
	chainSlug: string,
	externalId: string,
	cache: Map<string, string>,
): Promise<string | null> {
	const key = `${chainSlug}:${externalId}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}

	const db = getDatabase();
	const existing = await db
		.select({ id: retailerItems.id })
		.from(retailerItems)
		.where(
			and(
				eq(retailerItems.chainSlug, chainSlug),
				eq(retailerItems.externalId, externalId),
			),
		)
		.limit(1);

	if (existing[0]) {
		cache.set(key, existing[0].id);
		return existing[0].id;
	}

	return null;
}

async function findRetailerItemByBarcode(
	chainSlug: string,
	barcode: string,
	cache: Map<string, string>,
): Promise<string | null> {
	const key = `${chainSlug}:barcode:${barcode}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}

	const db = getDatabase();
	const existing = await db
		.select({ id: retailerItems.id })
		.from(retailerItemBarcodes)
		.innerJoin(
			retailerItems,
			eq(retailerItems.id, retailerItemBarcodes.retailerItemId),
		)
		.where(
			and(
				eq(retailerItemBarcodes.barcode, barcode),
				eq(retailerItems.chainSlug, chainSlug),
			),
		)
		.limit(1);

	if (existing[0]) {
		cache.set(key, existing[0].id);
		return existing[0].id;
	}

	return null;
}

async function upsertRetailerItem(
	chainSlug: string,
	row: NormalizedRow,
	archiveId: string | null,
	cacheByExternalId: Map<string, string>,
	cacheByBarcode: Map<string, string>,
): Promise<string> {
	const db = getDatabase();
	const externalId = row.externalId?.trim();

	if (externalId) {
		const existingId = await findRetailerItemByExternalId(
			chainSlug,
			externalId,
			cacheByExternalId,
		);
		if (existingId) {
			const updateData: Partial<typeof retailerItems.$inferInsert> = {
				name: row.name,
				description: row.description,
				category: row.category,
				subcategory: row.subcategory,
				brand: row.brand,
				unit: row.unit,
				unitQuantity: row.unitQuantity,
				imageUrl: row.imageUrl,
			};
			if (archiveId) {
				updateData.archiveId = archiveId;
			}

			await db
				.update(retailerItems)
				.set(updateData)
				.where(eq(retailerItems.id, existingId));

			if (row.barcodes.length > 0) {
				const primaryBarcode = row.barcodes[0] ?? null;
				const barcodeRows = row.barcodes.map((barcode) => ({
					id: generatePrefixedId("rib"),
					retailerItemId: existingId,
					barcode,
					isPrimary: barcode === primaryBarcode,
					createdAt: new Date(),
				}));
				await db
					.insert(retailerItemBarcodes)
					.values(barcodeRows)
					.onConflictDoNothing();
				for (const barcode of row.barcodes) {
					cacheByBarcode.set(`${chainSlug}:barcode:${barcode}`, existingId);
				}
			}
			return existingId;
		}
	}

	if (!externalId && row.barcodes.length > 0) {
		for (const barcode of row.barcodes) {
			const existingId = await findRetailerItemByBarcode(
				chainSlug,
				barcode,
				cacheByBarcode,
			);
			if (existingId) {
				return existingId;
			}
		}
	}

	const itemId = generatePrefixedId("rit");
	const primaryBarcode = row.barcodes[0] ?? null;

	await db.insert(retailerItems).values({
		id: itemId,
		name: row.name,
		externalId: externalId || null,
		description: row.description,
		category: row.category,
		subcategory: row.subcategory,
		brand: row.brand,
		unit: row.unit,
		unitQuantity: row.unitQuantity,
		imageUrl: row.imageUrl,
		barcode: primaryBarcode,
		chainSlug,
		archiveId: archiveId ?? null,
		createdAt: new Date(),
	});

	if (externalId) {
		cacheByExternalId.set(`${chainSlug}:${externalId}`, itemId);
	}

	if (row.barcodes.length > 0) {
		const barcodeRows = row.barcodes.map((barcode) => ({
			id: generatePrefixedId("rib"),
			retailerItemId: itemId,
			barcode,
			isPrimary: barcode === primaryBarcode,
			createdAt: new Date(),
		}));
		await db
			.insert(retailerItemBarcodes)
			.values(barcodeRows)
			.onConflictDoNothing();
		for (const barcode of row.barcodes) {
			cacheByBarcode.set(`${chainSlug}:barcode:${barcode}`, itemId);
		}
	}

	return itemId;
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
): Promise<void> {
	if (errors.length === 0) {
		return;
	}
	await getDatabase()
		.insert(ingestionErrors)
		.values(
			errors.map((err) => ({
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

async function insertFailedRows(
	rows: Array<{
		chainSlug: string;
		runId: string;
		fileId: bigint;
		storeIdentifier: string;
		row: NormalizedRow;
		errors: string[];
	}>,
): Promise<void> {
	if (rows.length === 0) {
		return;
	}

	await getDatabase()
		.insert(retailerItemsFailed)
		.values(
			rows.map((entry) => ({
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

	const parquetRows: ParquetPriceRow[] = [];
	const storeCache = new Map<string, string>();
	const itemCacheByExternalId = new Map<string, string>();
	const itemCacheByBarcode = new Map<string, string>();

	try {
		const adapter = getAdapter(chainSlug as never);
		const discoveredFiles = await adapter.discover(dateStr);
		log.info("Discovered files", { chainSlug, count: discoveredFiles.length });
		const storeIdentifierType = buildStoreIdentifierType(chainSlug);

		const filesToProcess: Array<{
			file: DiscoveredFile;
			content: Buffer;
			type: string;
			filename: string;
			hash: string;
			archiveId: string;
			expandedFrom?: string;
		}> = [];

		let fileIndex = 0;
		for (const file of discoveredFiles) {
			fileIndex++;
			if (fileIndex % 20 === 1 || fileIndex === discoveredFiles.length) {
				log.info("Fetching files", { progress: `${fileIndex}/${discoveredFiles.length}` });
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
				for (const inner of expanded) {
					const expandedKey = buildExpandedKey(
						chainSlug,
						targetDate,
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

		totalFiles = filesToProcess.length;
		await db
			.update(ingestionRuns)
			.set({
				totalFiles,
			})
			.where(eq(ingestionRuns.id, runId));

		for (const fileEntry of filesToProcess) {
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
						storageKey: fileEntry.expandedFrom
							? buildExpandedKey(
									chainSlug,
									targetDate,
									fileEntry.expandedFrom,
									fileEntry.filename,
								)
							: buildArchiveKey(chainSlug, targetDate, fileEntry.filename),
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
			let fileProcessedRows = 0;
			let fileWarningRows = 0;
			let fileFailedRows = 0;

			const parseResult = await adapter.parse(
				fileEntry.content,
				fileEntry.filename,
			);

			totalEntries += parseResult.totalRows;
			fileErrorCount += parseResult.errors.length;

			const parseErrors = mapParseErrors(runId, fileId, parseResult);
			await insertErrors(parseErrors);

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

				if (validation.warnings.length > 0) {
					fileWarningRows += 1;
				}

				const storeMetadata = adapter.extractStoreMetadata(fileEntry.file);
				const storeId = await resolveStoreId(
					chainSlug,
					storeIdentifier,
					storeIdentifierType,
					storeMetadata,
					storeCache,
				);

				const itemId = await upsertRetailerItem(
					chainSlug,
					row,
					fileEntry.archiveId,
					itemCacheByExternalId,
					itemCacheByBarcode,
				);

				const primaryBarcode = row.barcodes.length > 0 ? row.barcodes[0] : null;

				parquetRows.push({
					target_date: targetDate,
					chain_slug: chainSlug,
					store_id: storeId,
					retailer_item_id: itemId,
					external_id: row.externalId ?? null,
					name: row.name,
					barcode: primaryBarcode,
					price_cents: row.price,
					discount_price_cents: row.discountPrice ?? null,
					unit_price_cents: row.unitPrice ?? null,
					category: row.category ?? null,
					brand: row.brand ?? null,
				});

				fileProcessedRows += 1;

				const current = storeStats.get(storeIdentifier);
				if (current) {
					current.rowCount += 1;
					current.persistedCount += 1;
					current.warningRows += validation.warnings.length > 0 ? 1 : 0;
				} else {
					storeStats.set(storeIdentifier, {
						storeId,
						storeIdentifier,
						rowCount: 1,
						persistedCount: 1,
						failedRows: 0,
						warningRows: validation.warnings.length > 0 ? 1 : 0,
					});
				}
			}

			await insertFailedRows(failedRows);
			await insertErrors(validationErrors);

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
						processedRows: fileProcessedRows,
						failedRows: fileFailedRows,
						warningRows: fileWarningRows,
					}),
				})
				.where(eq(ingestionFiles.id, fileId));

			processedEntries += fileProcessedRows;
			processedFiles += 1;
			errorCount += fileErrorCount;

			await db
				.update(ingestionRuns)
				.set({
					processedFiles,
					processedEntries,
					totalEntries,
					errorCount,
				})
				.where(eq(ingestionRuns.id, runId));
		}

		if (parquetRows.length > 0) {
			const parquetKey = buildParquetKey(chainSlug, targetDate);
			await writePricesParquet(parquetKey, parquetRows);
			await recordParquetFile(chainSlug, targetDate, parquetKey);
		}

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
		});

		return { runId, status: "completed" };
	} catch (error) {
		log.error("Ingestion failed", {
			chainSlug,
			runId,
			error: errorToObject(error),
		});
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
