#!/usr/bin/env npx tsx

/**
 * Ingestion CLI Entry Point
 *
 * Unified CLI for ingestion pipeline commands.
 *
 * Usage:
 *   pnpm ingest <command> [options]
 *
 * Commands:
 *   stores     Manage stores (list, approve, reject, show)
 *   run        Run full ingestion pipeline
 *   discover   List available artifacts for a chain
 *   fetch      Download and store files
 *   expand     Expand ZIP files
 *   parse      Parse a single file
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program.name("ingest").description("Ingestion pipeline CLI").version("1.0.0");

// Helper to run a subcommand
function runSubcommand(scriptName: string, args: string[]): void {
	const scriptPath = path.join(__dirname, `${scriptName}.ts`);
	const child = spawn("npx", ["tsx", scriptPath, ...args], {
		stdio: "inherit",
	});

	child.on("close", (code) => {
		process.exit(code ?? 0);
	});

	child.on("error", (err) => {
		console.error(`Failed to start ${scriptName}:`, err.message);
		process.exit(1);
	});
}

// Stores subcommand
program
	.command("stores")
	.description(
		"Manage stores: list, approve, reject, add physical stores, and import from CSV",
	)
	.option("--pending", "List all pending stores")
	.option(
		"--chain <chain>",
		"List stores for a chain / required for --add and --import-csv",
	)
	.option("--approve <id>", "Approve a pending store")
	.option("--reject <id>", "Reject and delete a store")
	.option("--show <id>", "Show detailed store information")
	.option(
		"--add",
		"Add a new physical store (requires --chain, --name, --price-source)",
	)
	.option("--name <name>", "Store name (for --add)")
	.option("--address <address>", "Store address (for --add)")
	.option("--city <city>", "Store city (for --add)")
	.option("--postal-code <code>", "Store postal code (for --add)")
	.option("--lat <latitude>", "Store latitude (for --add)")
	.option("--lng <longitude>", "Store longitude (for --add)")
	.option(
		"--price-source <identifier>",
		"Price source store identifier (for --add, --link, --import-csv)",
	)
	.option(
		"--link <store_id>",
		"Link an existing store to a price source (requires --price-source)",
	)
	.option(
		"--import-csv <path>",
		"Import physical stores from CSV (requires --chain, --price-source)",
	)
	.allowUnknownOption(true)
	.action(() => {
		// Pass through all arguments to the stores script
		const args = process.argv.slice(process.argv.indexOf("stores") + 1);
		runSubcommand("stores", args);
	});

// Run subcommand
program
	.command("run")
	.description("Run the full ingestion pipeline")
	.allowUnknownOption(true)
	.action(() => {
		const args = process.argv.slice(process.argv.indexOf("run") + 1);
		runSubcommand("run", args);
	});

// Discover subcommand
program
	.command("discover")
	.description("List available artifacts/files for a chain")
	.allowUnknownOption(true)
	.action(() => {
		const args = process.argv.slice(process.argv.indexOf("discover") + 1);
		runSubcommand("discover", args);
	});

// Fetch subcommand
program
	.command("fetch")
	.description("Download files and record them for ingestion")
	.allowUnknownOption(true)
	.action(() => {
		const args = process.argv.slice(process.argv.indexOf("fetch") + 1);
		runSubcommand("fetch", args);
	});

// Expand subcommand
program
	.command("expand")
	.description("Expand ZIP files into entries")
	.allowUnknownOption(true)
	.action(() => {
		const args = process.argv.slice(process.argv.indexOf("expand") + 1);
		runSubcommand("expand", args);
	});

// Parse subcommand
program
	.command("parse")
	.description("Parse a single file using a chain adapter")
	.allowUnknownOption(true)
	.action(() => {
		const args = process.argv.slice(process.argv.indexOf("parse") + 1);
		runSubcommand("parse", args);
	});

program.parse();
