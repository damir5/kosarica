#!/usr/bin/env tsx
import { config } from "dotenv";
import { LocalStorage } from "@/lib/storage/local";
import { getS3StorageConfigFromEnv, S3Storage } from "@/lib/storage/s3";

const nodeEnv = process.env.NODE_ENV || "development";
config({ path: `.env.${nodeEnv}` });
config();

interface Flags {
	sourcePath: string;
	dryRun: boolean;
	verify: boolean;
	deleteLocal: boolean;
	prefixes: string[];
}

function parseFlags(argv: string[]): Flags {
	const sourcePath = process.env.STORAGE_PATH ?? "./data/storage";
	const flags: Flags = {
		sourcePath,
		dryRun: false,
		verify: true,
		deleteLocal: false,
		prefixes: ["archives/", "parquet/"],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") {
			flags.dryRun = true;
			continue;
		}
		if (arg === "--no-verify") {
			flags.verify = false;
			continue;
		}
		if (arg === "--delete-local") {
			flags.deleteLocal = true;
			continue;
		}
		if (arg.startsWith("--source-path=")) {
			flags.sourcePath = arg.slice("--source-path=".length);
			continue;
		}
		if (arg === "--source-path" && argv[index + 1]) {
			flags.sourcePath = argv[index + 1];
			index += 1;
			continue;
		}
		if (arg.startsWith("--prefixes=")) {
			const value = arg.slice("--prefixes=".length);
			flags.prefixes = value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
			continue;
		}
		if (arg === "--prefixes" && argv[index + 1]) {
			flags.prefixes = argv[index + 1]
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
			index += 1;
			continue;
		}
	}

	if (flags.prefixes.length === 0) {
		flags.prefixes = ["archives/", "parquet/"];
	}

	return flags;
}

function isDataKey(key: string): boolean {
	return !key.endsWith(".meta.json");
}

async function loadSourceKeys(
	source: LocalStorage,
	prefixes: string[],
): Promise<string[]> {
	const allKeys = new Set<string>();

	for (const prefix of prefixes) {
		const keys = await source.list(prefix);
		for (const key of keys) {
			if (isDataKey(key)) {
				allKeys.add(key);
			}
		}
	}

	return Array.from(allKeys).sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
	const flags = parseFlags(process.argv.slice(2));
	const source = new LocalStorage(flags.sourcePath);
	const target = new S3Storage(getS3StorageConfigFromEnv());
	const keys = await loadSourceKeys(source, flags.prefixes);

	console.log("=== Storage Migration: Local -> S3 ===");
	console.log(`Source path: ${flags.sourcePath}`);
	console.log(`Prefixes: ${flags.prefixes.join(", ")}`);
	console.log(`Dry run: ${flags.dryRun}`);
	console.log(`Verify existing: ${flags.verify}`);
	console.log(`Delete local after upload: ${flags.deleteLocal}`);
	console.log(`Candidate keys: ${keys.length}`);
	console.log("");

	let uploaded = 0;
	let skipped = 0;
	let deleted = 0;
	let failed = 0;

	for (const [index, key] of keys.entries()) {
		const position = index + 1;

		try {
			const sourceInfo = await source.getInfo(key);
			const remoteExists = await target.exists(key);
			let shouldUpload = true;

			if (remoteExists) {
				if (!flags.verify) {
					shouldUpload = false;
				} else {
					const remoteChecksum = await target.getChecksum(key);
					shouldUpload = remoteChecksum !== sourceInfo.checksum;
				}
			}

			if (shouldUpload) {
				if (!flags.dryRun) {
					const content = await source.get(key);
					await target.put(key, content, sourceInfo.metadata);
				}
				uploaded += 1;

				if (flags.deleteLocal && !flags.dryRun) {
					await source.delete(key);
					deleted += 1;
				}
			} else {
				skipped += 1;
			}

			if (position % 100 === 0 || position === keys.length) {
				console.log(
					`[${position}/${keys.length}] uploaded=${uploaded} skipped=${skipped} deleted=${deleted} failed=${failed}`,
				);
			}
		} catch (error) {
			failed += 1;
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[${position}/${keys.length}] FAILED key=${key}: ${message}`);
		}
	}

	console.log("");
	console.log("=== Migration Summary ===");
	console.log(`Uploaded: ${uploaded}`);
	console.log(`Skipped: ${skipped}`);
	console.log(`Deleted local: ${deleted}`);
	console.log(`Failed: ${failed}`);

	if (failed > 0) {
		process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
