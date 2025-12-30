#!/usr/bin/env npx tsx
/**
 * Discover CLI Command
 *
 * Lists available artifacts/files for a chain on a specific date.
 *
 * Usage: npx tsx src/ingestion/cli/discover.ts -c konzum -d 2025-12-29
 */

import { Command } from "commander";
import {
	CHAIN_IDS,
	type ChainId,
	chainAdapterRegistry,
	getChainConfig,
	isValidChainId,
} from "../chains";
import { createDmAdapter } from "../chains/dm";
import { createEurospinAdapter } from "../chains/eurospin";
import { createIntersparAdapter } from "../chains/interspar";
import { createKauflandAdapter } from "../chains/kaufland";
// Import all chain adapter factory functions
import { createKonzumAdapter } from "../chains/konzum";
import { createKtcAdapter } from "../chains/ktc";
import { createLidlAdapter } from "../chains/lidl";
import { createMetroAdapter } from "../chains/metro";
import { createPlodineAdapter } from "../chains/plodine";
import { createStudenacAdapter } from "../chains/studenac";
import { createTrgocentarAdapter } from "../chains/trgocentar";
import type { DiscoveredFile } from "../core/types";

/**
 * Register all chain adapters with the global registry.
 * Must be called before using chainAdapterRegistry.getAdapter().
 */
function registerAllAdapters(): void {
	chainAdapterRegistry.register("konzum", createKonzumAdapter());
	chainAdapterRegistry.register("lidl", createLidlAdapter());
	chainAdapterRegistry.register("plodine", createPlodineAdapter());
	chainAdapterRegistry.register("interspar", createIntersparAdapter());
	chainAdapterRegistry.register("studenac", createStudenacAdapter());
	chainAdapterRegistry.register("kaufland", createKauflandAdapter());
	chainAdapterRegistry.register("eurospin", createEurospinAdapter());
	chainAdapterRegistry.register("dm", createDmAdapter());
	chainAdapterRegistry.register("ktc", createKtcAdapter());
	chainAdapterRegistry.register("metro", createMetroAdapter());
	chainAdapterRegistry.register("trgocentar", createTrgocentarAdapter());
}

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
 * Validate date format (YYYY-MM-DD).
 */
function isValidDateFormat(dateStr: string): boolean {
	const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (!dateRegex.test(dateStr)) {
		return false;
	}

	// Validate it's an actual valid date
	const parsed = new Date(dateStr);
	return !Number.isNaN(parsed.getTime());
}

/**
 * Format file size in human-readable format.
 */
function formatFileSize(bytes: number | null): string {
	if (bytes === null) {
		return "-";
	}

	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format date in human-readable format.
 */
function formatDate(date: Date | null): string {
	if (date === null) {
		return "-";
	}

	return date.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Print files as a formatted table.
 */
function printTable(files: DiscoveredFile[]): void {
	if (files.length === 0) {
		console.log("No files discovered.");
		return;
	}

	// Calculate column widths
	const headers = ["URL", "Filename", "Type", "Size", "Last Modified"];
	const rows = files.map((file) => [
		file.url,
		file.filename,
		file.type,
		formatFileSize(file.size),
		formatDate(file.lastModified),
	]);

	// Get max width for each column (min 10, max 60 for URL)
	const widths = headers.map((header, i) => {
		const maxDataWidth = Math.max(...rows.map((row) => row[i].length));
		const minWidth = Math.max(header.length, 10);
		// Limit URL column to 60 characters
		const maxWidth = i === 0 ? 60 : 30;
		return Math.min(Math.max(maxDataWidth, minWidth), maxWidth);
	});

	// Print separator
	const separator = widths.map((w) => "-".repeat(w)).join("-+-");
	const formatRow = (row: string[]) =>
		row
			.map((cell, i) => {
				const truncated =
					cell.length > widths[i]
						? `${cell.substring(0, widths[i] - 3)}...`
						: cell;
				return truncated.padEnd(widths[i]);
			})
			.join(" | ");

	// Print header
	console.log(formatRow(headers));
	console.log(separator);

	// Print rows
	for (const row of rows) {
		console.log(formatRow(row));
	}

	// Print summary
	console.log("");
	console.log(`Total: ${files.length} file(s)`);
}

/**
 * Print files as JSON.
 */
function printJson(files: DiscoveredFile[]): void {
	console.log(JSON.stringify(files, null, 2));
}

/**
 * Main CLI program.
 */
async function main(): Promise<void> {
	const program = new Command();

	program
		.name("discover")
		.description("List available artifacts/files for a retail chain")
		.requiredOption("-c, --chain <chain>", `Chain ID (${CHAIN_IDS.join(", ")})`)
		.option(
			"-d, --date <date>",
			"Date in YYYY-MM-DD format (defaults to today)",
			getTodayDate(),
		)
		.option("-o, --output <format>", "Output format: json or table", "table")
		.parse(process.argv);

	const options = program.opts<{
		chain: string;
		date: string;
		output: string;
	}>();

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

	// Validate output format
	const outputFormat = options.output.toLowerCase();
	if (outputFormat !== "json" && outputFormat !== "table") {
		console.error(`Error: Invalid output format "${options.output}"`);
		console.error("Valid formats: json, table");
		process.exit(1);
	}

	// Register all adapters
	registerAllAdapters();

	// Get the adapter
	const chainId = options.chain as ChainId;
	const adapter = chainAdapterRegistry.getAdapter(chainId);

	if (!adapter) {
		console.error(`Error: No adapter registered for chain "${chainId}"`);
		process.exit(1);
	}

	// Get chain config for display
	const config = getChainConfig(chainId);

	// Output header (only for table format)
	if (outputFormat === "table") {
		console.log(`Discovering files for ${config.name} (${chainId})`);
		console.log(`Date: ${options.date}`);
		console.log(`Base URL: ${config.baseUrl}`);
		console.log("");
	}

	try {
		// Call the adapter's discover method
		const files = await adapter.discover();

		// Output results
		if (outputFormat === "json") {
			printJson(files);
		} else {
			printTable(files);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error discovering files: ${message}`);
		process.exit(1);
	}
}

// Run the CLI
main().catch((error) => {
	console.error("Unexpected error:", error);
	process.exit(1);
});
