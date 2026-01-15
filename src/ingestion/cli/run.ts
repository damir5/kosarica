#!/usr/bin/env npx tsx

/**
 * Run CLI Command - End-to-End Ingestion Pipeline
 *
 * Orchestrates the full ingestion pipeline: discover -> fetch -> expand -> parse -> persist
 *
 * Usage: npx tsx src/ingestion/cli/run.ts -c konzum -d 2025-12-29 [--store <store_id>]
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { drizzle } from "drizzle-orm/d1";
import { unzipSync } from "fflate";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import {
	CHAIN_IDS,
	type ChainId,
	getAdapterOrThrow,
	getChainConfig,
	isValidChainId,
} from "../chains";
import {
	persistRowsForStore,
	type StoreAutoRegisterOptions,
} from "../core/persist";
import { computeSha256, LocalStorage } from "../core/storage";
import type {
	DiscoveredFile,
	FetchedFile,
	FileType,
	NormalizedRow,
	ParseResult,
} from "../core/types";

/**
 * Metadata for a store collected during discovery/parse phase.
 * Used for auto-registration when a store is not found.
 */
interface StoreMetadata {
	/** Raw store name from portal/URL (e.g., "RC DUGO SELO PJ-90") */
	rawName: string;
	/** Clean store name with PJ-XX suffix removed (e.g., "RC DUGO SELO") */
	cleanName: string;
	/** Address extracted from filename if available */
	address?: string;
	/** City extracted from address if available */
	city?: string;
}

import * as schema from "@/db/schema";

// Note: Adapters are automatically registered when importing from '../chains'.
// No manual registration is required.

// Platform proxy for accessing Cloudflare bindings in local dev
let platformProxy: PlatformProxy<Env> | null = null;

// ============================================================================
// Types
// ============================================================================

interface CliOptions {
	chain: string;
	date: string;
	store?: string;
	dryRun: boolean;
	outputDir: string;
	verbose: boolean;
}

interface ExpandedEntry {
	filename: string;
	type: FileType;
	content: ArrayBuffer;
	hash: string;
	parentFile: DiscoveredFile;
}

interface PipelineStats {
	discovered: number;
	fetched: number;
	skippedDuplicate: number;
	expanded: number;
	parsed: number;
	totalRows: number;
	validRows: number;
	persisted: number;
	priceChanges: number;
	unchanged: number;
	failed: number;
	storesProcessed: number;
	storesNotFound: string[];
	errors: Array<{ phase: string; message: string }>;
	warnings: Array<{ phase: string; message: string }>;
}

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
 * Extract store metadata from a discovered file.
 * Extracts store name from URL path or metadata and cleans it.
 *
 * For KTC URLs like:
 * https://www.ktc.hr/ktcftp/Cjenici/SAMOPOSLUGA%20CAZMA%20PJ-89/TRGOVINA-...csv
 * The store folder is "SAMOPOSLUGA CAZMA PJ-89"
 *
 * @param file - Discovered file with URL and metadata
 * @param storeIdentifier - Store identifier extracted from filename (e.g., "PJ89-1")
 * @returns Store metadata for auto-registration
 */
function extractStoreMetadata(
	file: DiscoveredFile,
	storeIdentifier: string,
): StoreMetadata {
	let rawName = storeIdentifier; // Default to identifier

	// Try to extract from URL path (for KTC and similar)
	// URL format: .../Cjenici/STORE_FOLDER_NAME/filename.csv
	try {
		const url = new URL(file.url);
		const pathParts = url.pathname.split("/");
		// Find the folder containing the file (second to last part)
		if (pathParts.length >= 2) {
			const folderName = decodeURIComponent(pathParts[pathParts.length - 2]);
			// Check if it looks like a store name (not just "Cjenici" or similar)
			if (
				folderName &&
				folderName.length > 3 &&
				!folderName.toLowerCase().includes("cjeni")
			) {
				rawName = folderName;
			}
		}
	} catch {
		// URL parsing failed, use default
	}

	// Clean the store name by removing PJ-XX or PJ XX suffix
	// Examples:
	// "RC DUGO SELO PJ-90" -> "RC DUGO SELO"
	// "SAMOPOSLUGA CAZMA PJ-89" -> "SAMOPOSLUGA CAZMA"
	// "TRGOVINA VARAZDIN PJ7B" -> "TRGOVINA VARAZDIN"
	const cleanName = rawName
		.replace(/\s+PJ[- ]?\d+[A-Z]?$/i, "") // Remove " PJ-90", " PJ 90", " PJ7B" at end
		.replace(/\s+PJ[A-Z]?\d+$/i, "") // Remove " PJA50" at end (letter before number)
		.trim();

	// Try to extract city from the name or address
	// KTC filenames: TRGOVINA-ADDRESS-STORE_ID-DATE.csv
	// e.g., TRGOVINA-PAKRACKA ULICA 1 BJELOVAR-PJ50-1-20260105-071001.csv
	let address: string | undefined;
	let city: string | undefined;

	const decodedFilename = decodeURIComponent(file.filename);
	const filenameMatch = decodedFilename.match(
		/^TRGOVINA-(.+?)-(PJ[\dA-Z]+-\d+)-\d{8}/i,
	);
	if (filenameMatch) {
		const addressPart = filenameMatch[1];
		address = addressPart;

		// Try to extract city - usually the last word(s) in address that are all caps or proper case
		// e.g., "PAKRACKA ULICA 1 BJELOVAR" -> city is "BJELOVAR"
		const words = addressPart.split(" ");
		// Find the last word that looks like a city name (all caps, not a number)
		for (let i = words.length - 1; i >= 0; i--) {
			const word = words[i];
			if (word && /^[A-ZČĆŽŠĐ]+$/i.test(word) && !/^\d+$/.test(word)) {
				city = word;
				break;
			}
		}
	}

	return {
		rawName,
		cleanName: cleanName || rawName,
		address,
		city,
	};
}

/**
 * Validate date format (YYYY-MM-DD).
 */
function isValidDateFormat(dateStr: string): boolean {
	const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (!dateRegex.test(dateStr)) {
		return false;
	}
	const parsed = new Date(dateStr);
	return !Number.isNaN(parsed.getTime());
}

/**
 * Format file size in human-readable format.
 */
function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Detect file type from filename.
 */
function detectFileType(filename: string): FileType {
	const ext = path.extname(filename).toLowerCase();
	switch (ext) {
		case ".csv":
			return "csv";
		case ".xml":
			return "xml";
		case ".xlsx":
			return "xlsx";
		case ".zip":
			return "zip";
		default:
			return "csv"; // Default fallback
	}
}

/**
 * Initialize the platform proxy for accessing Cloudflare bindings.
 * Uses wrangler's getPlatformProxy to connect to local D1.
 */
async function initPlatformProxy(): Promise<PlatformProxy<Env>> {
	if (!platformProxy) {
		platformProxy = await getPlatformProxy<Env>({
			configPath: "./wrangler.jsonc",
			persist: true,
		});
	}
	return platformProxy;
}

/**
 * Cleanup platform proxy on exit.
 */
async function disposePlatformProxy(): Promise<void> {
	if (platformProxy) {
		await platformProxy.dispose();
		platformProxy = null;
	}
}

/**
 * Create a Drizzle database instance for CLI usage.
 * Uses wrangler's getPlatformProxy to access D1 bindings.
 */
async function createCliDatabase() {
	const proxy = await initPlatformProxy();
	return drizzle(proxy.env.DB, { schema });
}

// ============================================================================
// Logger
// ============================================================================

class Logger {
	private verbose: boolean;

	constructor(verbose: boolean) {
		this.verbose = verbose;
	}

	info(message: string): void {
		console.log(`[INFO] ${message}`);
	}

	success(message: string): void {
		console.log(`[OK] ${message}`);
	}

	warn(message: string): void {
		console.log(`[WARN] ${message}`);
	}

	error(message: string): void {
		console.error(`[ERROR] ${message}`);
	}

	debug(message: string): void {
		if (this.verbose) {
			console.log(`[DEBUG] ${message}`);
		}
	}

	phase(name: string): void {
		console.log("");
		console.log(`=== ${name} ===`);
	}
}

// ============================================================================
// Pipeline Phases
// ============================================================================

/**
 * Phase 1: Discover available files from the chain.
 */
async function discoverPhase(
	chainId: ChainId,
	dateFilter: string,
	storeFilter: string | undefined,
	logger: Logger,
	stats: PipelineStats,
): Promise<DiscoveredFile[]> {
	logger.phase("Phase 1: Discover");

	const adapter = getAdapterOrThrow(chainId);

	// Set discovery date for adapters that support it (Konzum, Lidl, etc.)
	if (
		"setDiscoveryDate" in adapter &&
		typeof adapter.setDiscoveryDate === "function"
	) {
		adapter.setDiscoveryDate(dateFilter);
		logger.debug(`Set discovery date to ${dateFilter} for ${adapter.name}`);
	}

	logger.info(`Discovering files for ${adapter.name}...`);

	const files = await adapter.discover();
	stats.discovered = files.length;

	logger.info(`Found ${files.length} file(s)`);

	// Filter by date if the file has lastModified
	let filtered = files.filter((file) => {
		if (!file.lastModified) return true; // Include files without date
		const fileDate = file.lastModified.toISOString().split("T")[0];
		return fileDate === dateFilter;
	});

	// Filter by store if specified
	if (storeFilter) {
		filtered = filtered.filter((file) => {
			const storeId = adapter.extractStoreIdentifier(file);
			return storeId?.value === storeFilter;
		});
		logger.debug(
			`Filtered to ${filtered.length} file(s) for store ${storeFilter}`,
		);
	}

	if (filtered.length === 0) {
		logger.warn("No files match the date/store filter");
		// Return all files if none match the date filter (adapter may not have dates)
		if (files.length > 0 && filtered.length === 0) {
			logger.info("Using all discovered files (no date metadata available)");
			return files;
		}
	}

	for (const file of filtered) {
		logger.debug(`  - ${file.filename} (${file.type})`);
	}

	return filtered;
}

/**
 * Phase 2: Fetch files and store locally with deduplication.
 */
async function fetchPhase(
	files: DiscoveredFile[],
	chainId: ChainId,
	storage: LocalStorage,
	logger: Logger,
	stats: PipelineStats,
): Promise<FetchedFile[]> {
	logger.phase("Phase 2: Fetch");

	const adapter = getAdapterOrThrow(chainId);

	const fetched: FetchedFile[] = [];

	for (const file of files) {
		logger.info(`Fetching ${file.filename}...`);

		try {
			const fetchedFile = await adapter.fetch(file);

			// Check for duplicate by hash
			const storageKey = `${chainId}/${file.filename}`;
			const existing = await storage.head(storageKey);

			if (existing?.sha256 === fetchedFile.hash) {
				logger.debug(`  Using cached: ${fetchedFile.hash.substring(0, 12)}...`);
				stats.skippedDuplicate++;

				// Retrieve cached content and add to fetched so expand phase can process it
				const cached = await storage.get(storageKey);
				if (cached) {
					fetched.push({
						discovered: file,
						content: cached.content,
						hash: fetchedFile.hash,
					});
				}
				continue;
			}

			// Store the file
			await storage.put(storageKey, fetchedFile.content, {
				sha256: fetchedFile.hash,
				customMetadata: {
					filename: file.filename,
					type: file.type,
					url: file.url,
				},
			});

			const size = fetchedFile.content.byteLength;
			logger.success(
				`  Stored: ${formatFileSize(size)} (${fetchedFile.hash.substring(0, 12)}...)`,
			);

			fetched.push(fetchedFile);
			stats.fetched++;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`  Failed to fetch: ${message}`);
			stats.errors.push({
				phase: "fetch",
				message: `${file.filename}: ${message}`,
			});
		}
	}

	logger.info(
		`Fetched ${fetched.length} file(s), skipped ${stats.skippedDuplicate} duplicate(s)`,
	);

	return fetched;
}

/**
 * Phase 3: Expand ZIP files.
 */
async function expandPhase(
	files: FetchedFile[],
	storage: LocalStorage,
	chainId: ChainId,
	logger: Logger,
	stats: PipelineStats,
): Promise<ExpandedEntry[]> {
	logger.phase("Phase 3: Expand");

	const entries: ExpandedEntry[] = [];

	for (const file of files) {
		if (file.discovered.type !== "zip") {
			// Not a ZIP, treat as single entry
			entries.push({
				filename: file.discovered.filename,
				type: file.discovered.type,
				content: file.content,
				hash: file.hash,
				parentFile: file.discovered,
			});
			continue;
		}

		logger.info(`Expanding ${file.discovered.filename}...`);

		try {
			const uint8Content = new Uint8Array(file.content);
			const unzipped = unzipSync(uint8Content);

			let expandedCount = 0;
			for (const [innerFilename, innerContent] of Object.entries(unzipped)) {
				// Skip directories and hidden files
				if (
					innerFilename.endsWith("/") ||
					innerFilename.startsWith("__MACOSX")
				) {
					continue;
				}

				const innerType = detectFileType(innerFilename);
				const innerHash = await computeSha256(innerContent);

				// Store expanded file
				const storageKey = `${chainId}/expanded/${file.discovered.filename}/${innerFilename}`;
				await storage.put(storageKey, innerContent, {
					sha256: innerHash,
					customMetadata: {
						parentFilename: file.discovered.filename,
						innerFilename,
						type: innerType,
					},
				});

				entries.push({
					filename: innerFilename,
					type: innerType,
					content: innerContent.buffer as ArrayBuffer,
					hash: innerHash,
					parentFile: file.discovered,
				});

				expandedCount++;
				stats.expanded++;
				logger.debug(
					`  - ${innerFilename} (${formatFileSize(innerContent.byteLength)})`,
				);
			}

			logger.success(`  Expanded ${expandedCount} file(s)`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`  Failed to expand: ${message}`);
			stats.errors.push({
				phase: "expand",
				message: `${file.discovered.filename}: ${message}`,
			});
		}
	}

	// Count non-ZIP files as "expanded" for stats
	const nonZipCount = files.filter((f) => f.discovered.type !== "zip").length;
	if (nonZipCount > 0) {
		logger.info(`${nonZipCount} non-ZIP file(s) passed through`);
	}

	return entries;
}

/**
 * Result from parse phase including rows and store metadata.
 */
interface ParsePhaseResult {
	rowsByStore: Map<string, NormalizedRow[]>;
	storeMetadataMap: Map<string, StoreMetadata>;
}

/**
 * Phase 4: Parse all entries.
 */
async function parsePhase(
	entries: ExpandedEntry[],
	chainId: ChainId,
	logger: Logger,
	stats: PipelineStats,
): Promise<ParsePhaseResult> {
	logger.phase("Phase 4: Parse");

	const adapter = getAdapterOrThrow(chainId);

	// Group rows by store identifier
	const rowsByStore = new Map<string, NormalizedRow[]>();
	// Track store metadata for auto-registration
	const storeMetadataMap = new Map<string, StoreMetadata>();

	for (const entry of entries) {
		logger.info(`Parsing ${entry.filename}...`);

		try {
			const result: ParseResult = await adapter.parse(
				entry.content,
				entry.filename,
			);

			stats.parsed++;
			stats.totalRows += result.totalRows;
			stats.validRows += result.validRows;

			logger.success(
				`  Parsed: ${result.validRows}/${result.totalRows} valid rows`,
			);

			// Report errors
			if (result.errors.length > 0) {
				logger.warn(`  ${result.errors.length} error(s)`);
				for (const err of result.errors.slice(0, 5)) {
					const loc = err.rowNumber ? `Row ${err.rowNumber}` : "Unknown";
					logger.debug(`    ${loc}: ${err.message}`);
					stats.warnings.push({
						phase: "parse",
						message: `${entry.filename} ${loc}: ${err.message}`,
					});
				}
				if (result.errors.length > 5) {
					logger.debug(`    ... and ${result.errors.length - 5} more errors`);
				}
			}

			// Report warnings
			if (result.warnings.length > 0) {
				logger.debug(`  ${result.warnings.length} warning(s)`);
			}

			// Group rows by store
			for (const row of result.rows) {
				const storeId = row.storeIdentifier || "unknown";
				if (!rowsByStore.has(storeId)) {
					rowsByStore.set(storeId, []);
					// Extract and store metadata for this store identifier
					const metadata = extractStoreMetadata(entry.parentFile, storeId);
					storeMetadataMap.set(storeId, metadata);
				}
				rowsByStore.get(storeId)?.push(row);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`  Failed to parse: ${message}`);
			stats.errors.push({
				phase: "parse",
				message: `${entry.filename}: ${message}`,
			});
		}
	}

	logger.info(
		`Parsed ${stats.validRows} valid rows across ${rowsByStore.size} store(s)`,
	);

	return { rowsByStore, storeMetadataMap };
}

/**
 * Map chain storeResolution strategy to store identifier type.
 */
function getIdentifierTypeFromResolution(
	resolution: "filename" | "portal_id" | "national",
): string {
	switch (resolution) {
		case "filename":
			return "filename_code";
		case "portal_id":
			return "portal_id";
		case "national":
			return "national";
		default:
			return "filename_code";
	}
}

/**
 * Phase 5: Persist to database.
 */
async function persistPhase(
	rowsByStore: Map<string, NormalizedRow[]>,
	storeMetadataMap: Map<string, StoreMetadata>,
	chainId: ChainId,
	dryRun: boolean,
	logger: Logger,
	stats: PipelineStats,
): Promise<void> {
	logger.phase(`Phase 5: Persist${dryRun ? " (DRY RUN)" : ""}`);

	if (dryRun) {
		logger.info("Dry run mode - no data will be persisted");

		for (const [storeId, rows] of rowsByStore) {
			const metadata = storeMetadataMap.get(storeId);
			logger.info(
				`  Store "${storeId}" (${metadata?.cleanName || "unknown"}): ${rows.length} row(s) would be persisted`,
			);
			stats.storesProcessed++;
		}

		logger.info("");
		logger.info("Dry run complete. Use without --dry-run to persist data.");
		return;
	}

	// Create database connection
	const db = await createCliDatabase();

	// Get chain config to determine store identifier type
	const config = getChainConfig(chainId);
	const identifierType = getIdentifierTypeFromResolution(
		config.storeResolution,
	);

	for (const [storeIdentifier, rows] of rowsByStore) {
		const metadata = storeMetadataMap.get(storeIdentifier);
		logger.info(
			`Persisting ${rows.length} row(s) for store "${storeIdentifier}" (${metadata?.cleanName || "unknown"})...`,
		);

		// Prepare auto-registration options from metadata
		const autoRegister: StoreAutoRegisterOptions | undefined = metadata
			? {
					name: metadata.cleanName,
					address: metadata.address,
					city: metadata.city,
				}
			: undefined;

		try {
			const result = await persistRowsForStore(
				db,
				chainId,
				storeIdentifier,
				rows,
				identifierType,
				autoRegister,
			);

			if (result === null) {
				logger.warn(
					`  Store not found and auto-registration failed: "${storeIdentifier}"`,
				);
				stats.storesNotFound.push(storeIdentifier);
				continue;
			}

			stats.storesProcessed++;
			stats.persisted += result.persisted;
			stats.priceChanges += result.priceChanges;
			stats.unchanged += result.unchanged;
			stats.failed += result.failed;

			logger.success(
				`  Persisted: ${result.persisted}, price changes: ${result.priceChanges}, unchanged: ${result.unchanged}, failed: ${result.failed}`,
			);

			if (result.errors.length > 0) {
				for (const err of result.errors.slice(0, 3)) {
					logger.debug(`    Row ${err.rowNumber}: ${err.error}`);
				}
				if (result.errors.length > 3) {
					logger.debug(`    ... and ${result.errors.length - 3} more errors`);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`  Failed to persist: ${message}`);
			stats.errors.push({
				phase: "persist",
				message: `Store "${storeIdentifier}": ${message}`,
			});
		}
	}
}

/**
 * Print final summary.
 */
function printSummary(stats: PipelineStats, logger: Logger): void {
	logger.phase("Summary");

	console.log("");
	console.log("Pipeline Statistics:");
	console.log(`  Discovered:       ${stats.discovered} file(s)`);
	console.log(`  Fetched:          ${stats.fetched} file(s)`);
	console.log(`  Skipped (dedup):  ${stats.skippedDuplicate} file(s)`);
	console.log(`  Expanded:         ${stats.expanded} entry/entries`);
	console.log(`  Parsed:           ${stats.parsed} file(s)`);
	console.log(`  Total rows:       ${stats.totalRows}`);
	console.log(`  Valid rows:       ${stats.validRows}`);
	console.log("");
	console.log("Persistence Statistics:");
	console.log(`  Stores processed: ${stats.storesProcessed}`);
	console.log(`  Rows persisted:   ${stats.persisted}`);
	console.log(`  Price changes:    ${stats.priceChanges}`);
	console.log(`  Unchanged:        ${stats.unchanged}`);
	console.log(`  Failed:           ${stats.failed}`);

	if (stats.storesNotFound.length > 0) {
		console.log("");
		console.log(`Stores not found (${stats.storesNotFound.length}):`);
		for (const store of stats.storesNotFound.slice(0, 10)) {
			console.log(`  - ${store}`);
		}
		if (stats.storesNotFound.length > 10) {
			console.log(`  ... and ${stats.storesNotFound.length - 10} more`);
		}
	}

	if (stats.errors.length > 0) {
		console.log("");
		console.log(`Errors (${stats.errors.length}):`);
		for (const err of stats.errors.slice(0, 10)) {
			console.log(`  [${err.phase}] ${err.message}`);
		}
		if (stats.errors.length > 10) {
			console.log(`  ... and ${stats.errors.length - 10} more`);
		}
	}

	console.log("");
}

// ============================================================================
// Main CLI
// ============================================================================

async function main(): Promise<void> {
	const program = new Command();

	program
		.name("run")
		.description(
			"Run the full ingestion pipeline: discover -> fetch -> expand -> parse -> persist",
		)
		.requiredOption("-c, --chain <chain>", `Chain ID (${CHAIN_IDS.join(", ")})`)
		.option(
			"-d, --date <date>",
			"Date in YYYY-MM-DD format (defaults to today)",
			getTodayDate(),
		)
		.option("-s, --store <store_id>", "Specific store ID to filter")
		.option("--dry-run", "Run without persisting to database", false)
		.option(
			"-o, --output-dir <dir>",
			"Output directory for fetched files",
			"./data/ingestion",
		)
		.option("-v, --verbose", "Verbose output", false)
		.parse(process.argv);

	const options = program.opts<CliOptions>();

	// Validate chain ID
	if (!isValidChainId(options.chain)) {
		console.error(`Error: Invalid chain ID "${options.chain}"`);
		console.error(`Valid chain IDs: ${CHAIN_IDS.join(", ")}`);
		process.exit(1);
	}

	// Validate date format
	if (!isValidDateFormat(options.date)) {
		console.error(`Error: Invalid date format "${options.date}"`);
		console.error("Expected format: YYYY-MM-DD (e.g., 2025-12-29)");
		process.exit(1);
	}

	const chainId = options.chain as ChainId;
	const logger = new Logger(options.verbose);
	const config = getChainConfig(chainId);

	// Initialize stats
	const stats: PipelineStats = {
		discovered: 0,
		fetched: 0,
		skippedDuplicate: 0,
		expanded: 0,
		parsed: 0,
		totalRows: 0,
		validRows: 0,
		persisted: 0,
		priceChanges: 0,
		unchanged: 0,
		failed: 0,
		storesProcessed: 0,
		storesNotFound: [],
		errors: [],
		warnings: [],
	};

	// Print header
	console.log("=".repeat(60));
	console.log(`Ingestion Pipeline: ${config.name}`);
	console.log("=".repeat(60));
	console.log(`Chain:      ${chainId}`);
	console.log(`Date:       ${options.date}`);
	console.log(`Store:      ${options.store || "(all)"}`);
	console.log(`Output:     ${path.resolve(options.outputDir)}`);
	console.log(`Dry run:    ${options.dryRun}`);
	console.log(`Verbose:    ${options.verbose}`);

	// Register adapters
	// Adapters are pre-registered via centralized initialization in '../chains'

	// Initialize storage
	const outputDir = path.resolve(options.outputDir);
	await fs.mkdir(outputDir, { recursive: true });
	const storage = new LocalStorage(outputDir);

	try {
		// Phase 1: Discover
		const files = await discoverPhase(
			chainId,
			options.date,
			options.store,
			logger,
			stats,
		);

		if (files.length === 0) {
			logger.warn("No files to process. Exiting.");
			printSummary(stats, logger);
			process.exit(0);
		}

		// Phase 2: Fetch
		const fetched = await fetchPhase(files, chainId, storage, logger, stats);

		if (fetched.length === 0 && stats.skippedDuplicate === 0) {
			logger.warn("No files fetched. Exiting.");
			printSummary(stats, logger);
			process.exit(0);
		}

		// Phase 3: Expand
		const entries = await expandPhase(fetched, storage, chainId, logger, stats);

		if (entries.length === 0) {
			logger.warn("No entries to parse. Exiting.");
			printSummary(stats, logger);
			process.exit(0);
		}

		// Phase 4: Parse
		const { rowsByStore, storeMetadataMap } = await parsePhase(
			entries,
			chainId,
			logger,
			stats,
		);

		if (rowsByStore.size === 0) {
			logger.warn("No rows to persist. Exiting.");
			printSummary(stats, logger);
			process.exit(0);
		}

		// Phase 5: Persist
		await persistPhase(
			rowsByStore,
			storeMetadataMap,
			chainId,
			options.dryRun,
			logger,
			stats,
		);

		// Print summary
		printSummary(stats, logger);

		// Cleanup platform proxy
		await disposePlatformProxy();

		// Exit with appropriate code
		if (stats.errors.length > 0) {
			process.exit(2);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`Pipeline failed: ${message}`);
		if (options.verbose && error instanceof Error && error.stack) {
			console.error(error.stack);
		}
		printSummary(stats, logger);

		// Cleanup platform proxy
		await disposePlatformProxy();

		process.exit(1);
	}
}

// Run the CLI
main().catch(async (error) => {
	console.error("Unexpected error:", error);
	await disposePlatformProxy();
	process.exit(1);
});
