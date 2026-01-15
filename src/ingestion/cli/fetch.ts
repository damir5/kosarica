#!/usr/bin/env node

/**
 * Fetch CLI Command
 *
 * Downloads files from URLs or local paths and records them for the ingestion pipeline.
 *
 * Usage: npx tsx src/ingestion/cli/fetch.ts -c konzum -u <url_or_path>
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { CHAIN_IDS, type ChainId, isValidChainId } from "../chains";
import { computeSha256, LocalStorage } from "../core/storage";
import type { FileType } from "../core/types";

// Note: Adapters are automatically registered when importing from '../chains'.
// No manual registration is required.

/**
 * Detect file type from URL or filename.
 */
function detectFileType(urlOrPath: string): FileType {
	const lowerPath = urlOrPath.toLowerCase();
	if (lowerPath.endsWith(".csv")) return "csv";
	if (lowerPath.endsWith(".xml")) return "xml";
	if (lowerPath.endsWith(".xlsx") || lowerPath.endsWith(".xls")) return "xlsx";
	if (lowerPath.endsWith(".zip")) return "zip";
	// Default to csv
	return "csv";
}

/**
 * Extract filename from URL or path.
 */
function extractFilename(urlOrPath: string): string {
	// Handle URLs
	if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
		try {
			const url = new URL(urlOrPath);
			const pathname = url.pathname;
			const parts = pathname.split("/");
			const filename = parts[parts.length - 1];
			if (filename) {
				return decodeURIComponent(filename);
			}
		} catch {
			// Fall through to path handling
		}
	}

	// Handle local paths
	return path.basename(urlOrPath);
}

/**
 * Check if the URL is a remote HTTP(S) URL.
 */
function isRemoteUrl(urlOrPath: string): boolean {
	return urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://");
}

/**
 * Get current date in YYYY-MM-DD format.
 */
function getCurrentDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Result of the fetch operation.
 */
interface FetchResult {
	chain: ChainId;
	url: string;
	filename: string;
	storedPath: string;
	hash: string;
	size: number;
	fileType: FileType;
}

/**
 * Fetch and store a file.
 */
async function fetchAndStore(
	chainId: ChainId,
	urlOrPath: string,
	outputDir: string,
): Promise<FetchResult> {
	const filename = extractFilename(urlOrPath);
	const fileType = detectFileType(urlOrPath);
	const date = getCurrentDate();

	// Fetch the content
	let content: ArrayBuffer;

	if (isRemoteUrl(urlOrPath)) {
		// Fetch from remote URL
		const response = await fetch(urlOrPath);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch ${urlOrPath}: ${response.status} ${response.statusText}`,
			);
		}
		content = await response.arrayBuffer();
	} else {
		// Read from local filesystem
		const absolutePath = path.isAbsolute(urlOrPath)
			? urlOrPath
			: path.resolve(process.cwd(), urlOrPath);

		const fileBuffer = await fs.readFile(absolutePath);
		content = fileBuffer.buffer.slice(
			fileBuffer.byteOffset,
			fileBuffer.byteOffset + fileBuffer.byteLength,
		) as ArrayBuffer;
	}

	// Compute SHA256 hash
	const hash = await computeSha256(content);

	// Create storage and save file
	const storage = new LocalStorage(outputDir);
	const storageKey = `${chainId}/${date}/${filename}`;

	await storage.put(storageKey, content, {
		sha256: hash,
		customMetadata: {
			chain: chainId,
			sourceUrl: urlOrPath,
			fileType,
			fetchedAt: new Date().toISOString(),
		},
	});

	const storedPath = path.join(outputDir, storageKey);

	return {
		chain: chainId,
		url: urlOrPath,
		filename,
		storedPath,
		hash,
		size: content.byteLength,
		fileType,
	};
}

/**
 * Main CLI program.
 */
async function main(): Promise<void> {
	const program = new Command();

	program
		.name("fetch")
		.description("Download files and record them for the ingestion pipeline")
		.requiredOption("-c, --chain <chain>", `Chain ID (${CHAIN_IDS.join(", ")})`)
		.requiredOption("-u, --url <url>", "URL or local file path to fetch")
		.option("-o, --output-dir <dir>", "Output directory", "./data/ingestion")
		.option("--json", "Output result as JSON")
		.action(async (options) => {
			const { chain, url, outputDir, json } = options;

			// Validate chain ID
			if (!isValidChainId(chain)) {
				console.error(`Error: Invalid chain ID '${chain}'`);
				console.error(`Valid chain IDs: ${CHAIN_IDS.join(", ")}`);
				process.exit(1);
			}

			// Adapters are pre-registered via centralized initialization in '../chains'

			try {
				const result = await fetchAndStore(chain as ChainId, url, outputDir);

				if (json) {
					console.log(JSON.stringify(result, null, 2));
				} else {
					console.log("File fetched and stored successfully!");
					console.log("");
					console.log(`  Chain:       ${result.chain}`);
					console.log(`  Source:      ${result.url}`);
					console.log(`  Filename:    ${result.filename}`);
					console.log(`  Stored at:   ${result.storedPath}`);
					console.log(`  SHA256:      ${result.hash}`);
					console.log(`  Size:        ${result.size} bytes`);
					console.log(`  File type:   ${result.fileType}`);
				}
			} catch (error) {
				if (json) {
					console.log(
						JSON.stringify(
							{
								error: error instanceof Error ? error.message : String(error),
							},
							null,
							2,
						),
					);
				} else {
					console.error(
						`Error: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				process.exit(1);
			}
		});

	await program.parseAsync(process.argv);
}

// Run the CLI
main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
