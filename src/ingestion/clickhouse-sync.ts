import { inArray } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import { getDatabase } from "@/db";
import { parquetFiles } from "@/db/schema";
import { getClickHouseBatch } from "@/lib/clickhouse";
import { getStorage, LocalStorage, resolveStoragePath } from "@/lib/storage";

export interface ClickHouseSyncStatus {
	totalFiles: number;
	importedFiles: number;
	pendingFiles: number;
	lastImportedAt?: Date | null;
}

interface LoadMissingOptions {
	/**
	 * Restrict sync to parquet snapshots whose target date is within
	 * the last `maxAgeDays` days (UTC), inclusive.
	 */
	maxAgeDays?: number;
	/**
	 * When true (default), parquet files with updated metadata are
	 * re-imported (delete + import). For daily refresh pipelines on
	 * constrained disks, this can be disabled to import only never-seen files.
	 */
	reimportUpdated?: boolean;
}

function parseParquetKey(storageKey: string): Result<
	{
		chainSlug: string;
		targetDate: Date;
	},
	Error
> {
	const match = storageKey.match(
		/^parquet\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/prices\.parquet$/,
	);
	if (!match) {
		return err(new Error(`invalid parquet storage key: ${storageKey}`));
	}

	const [, chainSlug, dateStr] = match;
	const [year, month, day] = dateStr.split("-").map((part) => Number(part));
	const targetDate = new Date(Date.UTC(year, month - 1, day));
	return ok({ chainSlug, targetDate });
}

async function listParquetKeys(): Promise<string[]> {
	const storage = getStorage();
	const keys = await storage.list("parquet/");
	return keys.filter((key) => key.endsWith(".parquet"));
}

async function upsertParquetRecord(
	storageKey: string,
	importedAt: Date | null,
): Promise<Result<void, Error>> {
	const parseResult = parseParquetKey(storageKey);
	if (parseResult.isErr()) {
		return Promise.resolve(err(parseResult.error));
	}
	const { chainSlug, targetDate } = parseResult.value;

	const db = getDatabase();
	const storage = getStorage();
	const info = await storage.getInfo(storageKey);
	const syncedAt = importedAt ?? new Date();

	const targetDateStr = targetDate.toISOString().split("T")[0];
	await db
		.insert(parquetFiles)
		.values({
			chainSlug,
			targetDate: targetDateStr,
			storageKey,
			fileSize: info.size,
			checksum: info.checksum,
			importedAt,
			updatedAt: syncedAt,
		})
		.onConflictDoUpdate({
			target: parquetFiles.storageKey,
			set: {
				chainSlug,
				targetDate: targetDateStr,
				fileSize: info.size,
				checksum: info.checksum,
				importedAt,
				updatedAt: syncedAt,
			},
		});
	return Promise.resolve(ok(undefined));
}

type ParquetImportState = {
	storageKey: string;
	importedAt: Date | null;
	updatedAt: Date;
};

async function loadParquetImportState(
	keys: string[],
): Promise<Map<string, ParquetImportState>> {
	const db = getDatabase();
	const states = new Map<string, ParquetImportState>();
	if (keys.length === 0) {
		return states;
	}

	const rows = await db
		.select({
			storageKey: parquetFiles.storageKey,
			importedAt: parquetFiles.importedAt,
			updatedAt: parquetFiles.updatedAt,
		})
		.from(parquetFiles)
		.where(inArray(parquetFiles.storageKey, keys));

	for (const row of rows) {
		states.set(row.storageKey, {
			storageKey: row.storageKey,
			importedAt: row.importedAt ?? null,
			updatedAt: row.updatedAt,
		});
	}

	return states;
}

async function importParquetStorageKey(
	storageKey: string,
	clickhouse: ReturnType<typeof getClickHouseBatch>,
): Promise<void> {
	const storage = getStorage();

	if (storage instanceof LocalStorage) {
		const filePath = resolveStoragePath(storageKey);
		await clickhouse.importParquetFile(filePath);
		return;
	}

	const payload = await storage.get(storageKey);
	await clickhouse.importParquetBuffer(payload);
}

export async function loadAllToClickHouse(): Promise<
	Result<
		{
			imported: number;
			importedChains: string[];
		},
		Error
	>
> {
	const keys = await listParquetKeys();
	const clickhouse = getClickHouseBatch();

	await clickhouse.truncatePrices();

	let imported = 0;
	const importedChains = new Set<string>();
	for (const key of keys) {
		const parseResult = parseParquetKey(key);
		if (parseResult.isErr()) {
			return err(parseResult.error);
		}
		const { chainSlug } = parseResult.value;
		await importParquetStorageKey(key, clickhouse);
		const upsertResult = await upsertParquetRecord(key, new Date());
		if (upsertResult.isErr()) {
			return err(upsertResult.error);
		}
		importedChains.add(chainSlug);
		imported += 1;
	}

	return ok({ imported, importedChains: Array.from(importedChains) });
}

export async function loadMissingToClickHouse(
	options?: LoadMissingOptions,
): Promise<
	Result<
		{
			imported: number;
			pending: number;
			importedChains: string[];
		},
		Error
	>
> {
	const clickhouse = getClickHouseBatch();
	const keys = await listParquetKeys();
	const stateByKey = await loadParquetImportState(keys);
	const now = new Date();
	const maxAgeDaysRaw = options?.maxAgeDays;
	const reimportUpdated = options?.reimportUpdated ?? true;
	const maxAgeDays =
		typeof maxAgeDaysRaw === "number" &&
		Number.isFinite(maxAgeDaysRaw) &&
		maxAgeDaysRaw >= 0
			? Math.floor(maxAgeDaysRaw)
			: null;
	const minTargetDate =
		maxAgeDays === null
			? null
			: new Date(
					Date.UTC(
						now.getUTCFullYear(),
						now.getUTCMonth(),
						now.getUTCDate() - maxAgeDays,
					),
				);

	// Build pending items list with error handling
	const pendingItems: {
		key: string;
		chainSlug: string;
		targetDate: string;
		replaceExisting: boolean;
	}[] = [];

	for (const key of keys) {
		const parseResult = parseParquetKey(key);
		if (parseResult.isErr()) {
			return err(parseResult.error);
		}
		const { chainSlug, targetDate } = parseResult.value;

		if (minTargetDate && targetDate < minTargetDate) {
			continue;
		}

		const state = stateByKey.get(key);
		if (!state) {
			pendingItems.push({
				key,
				chainSlug,
				targetDate: targetDate.toISOString().slice(0, 10),
				replaceExisting: false,
			});
			continue;
		}
		if (!state.importedAt) {
			pendingItems.push({
				key,
				chainSlug,
				targetDate: targetDate.toISOString().slice(0, 10),
				replaceExisting: false,
			});
			continue;
		}
		if (reimportUpdated && state.updatedAt > state.importedAt) {
			pendingItems.push({
				key,
				chainSlug,
				targetDate: targetDate.toISOString().slice(0, 10),
				replaceExisting: true,
			});
		}
	}

	let imported = 0;
	const importedChains = new Set<string>();
	for (const item of pendingItems) {
		if (item.replaceExisting) {
			// Clear chain/day snapshot first to keep re-import idempotent.
			await clickhouse.deleteSnapshot(item.chainSlug, item.targetDate);
		}

		await importParquetStorageKey(item.key, clickhouse);
		const upsertResult = await upsertParquetRecord(item.key, new Date());
		if (upsertResult.isErr()) {
			return err(upsertResult.error);
		}
		importedChains.add(item.chainSlug);
		imported += 1;
	}

	return ok({
		imported,
		pending: Math.max(pendingItems.length - imported, 0),
		importedChains: Array.from(importedChains),
	});
}

export async function getClickHouseSyncStatus(): Promise<ClickHouseSyncStatus> {
	const keys = await listParquetKeys();
	const stateByKey = await loadParquetImportState(keys);
	const importedFiles = keys.filter((key) => {
		const state = stateByKey.get(key);
		return Boolean(state?.importedAt && state.updatedAt <= state.importedAt);
	}).length;
	const pendingFiles = keys.length - importedFiles;
	const importedTimestamps = keys
		.map((key) => stateByKey.get(key)?.importedAt ?? null)
		.filter((value): value is Date => value instanceof Date);
	const lastImportedAt = importedTimestamps.reduce<Date | null>(
		(currentMax, value) =>
			!currentMax || value > currentMax ? value : currentMax,
		null,
	);
	const totalFiles = keys.length;

	return {
		totalFiles,
		importedFiles,
		pendingFiles,
		lastImportedAt,
	};
}
