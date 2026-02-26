import { inArray } from "drizzle-orm";
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

function parseParquetKey(storageKey: string): {
	chainSlug: string;
	targetDate: Date;
} {
	const match = storageKey.match(
		/^parquet\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/prices\.parquet$/,
	);
	if (!match) {
		throw new Error(`invalid parquet storage key: ${storageKey}`);
	}

	const [, chainSlug, dateStr] = match;
	const [year, month, day] = dateStr.split("-").map((part) => Number(part));
	const targetDate = new Date(Date.UTC(year, month - 1, day));
	return { chainSlug, targetDate };
}

async function listParquetKeys(): Promise<string[]> {
	const storage = getStorage();
	const keys = await storage.list("parquet/");
	return keys.filter((key) => key.endsWith(".parquet"));
}

async function upsertParquetRecord(
	storageKey: string,
	importedAt: Date | null,
): Promise<void> {
	const db = getDatabase();
	const storage = getStorage();
	const info = await storage.getInfo(storageKey);
	const { chainSlug, targetDate } = parseParquetKey(storageKey);
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

export async function loadAllToClickHouse(): Promise<{
	imported: number;
}> {
	const keys = await listParquetKeys();
	const clickhouse = getClickHouseBatch();

	await clickhouse.truncatePrices();

	let imported = 0;
	for (const key of keys) {
		await importParquetStorageKey(key, clickhouse);
		await upsertParquetRecord(key, new Date());
		imported += 1;
	}

	return { imported };
}

export async function loadMissingToClickHouse(
	options?: LoadMissingOptions,
): Promise<{
	imported: number;
	pending: number;
}> {
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

	const pendingItems = keys.flatMap((key) => {
		if (minTargetDate) {
			const { targetDate } = parseParquetKey(key);
			if (targetDate < minTargetDate) {
				return [];
			}
		}

		const state = stateByKey.get(key);
		if (!state) {
			const { chainSlug, targetDate } = parseParquetKey(key);
			return [
				{
					key,
					chainSlug,
					targetDate: targetDate.toISOString().slice(0, 10),
					replaceExisting: false,
				},
			];
		}
		if (!state.importedAt) {
			const { chainSlug, targetDate } = parseParquetKey(key);
			return [
				{
					key,
					chainSlug,
					targetDate: targetDate.toISOString().slice(0, 10),
					replaceExisting: false,
				},
			];
		}
		if (!reimportUpdated || state.updatedAt <= state.importedAt) {
			return [];
		}

		const { chainSlug, targetDate } = parseParquetKey(key);
		return [
			{
				key,
				chainSlug,
				targetDate: targetDate.toISOString().slice(0, 10),
				replaceExisting: true,
			},
		];
	});

	let imported = 0;
	for (const item of pendingItems) {
		if (item.replaceExisting) {
			// Clear chain/day snapshot first to keep re-import idempotent.
			await clickhouse.deleteSnapshot(item.chainSlug, item.targetDate);
		}

		await importParquetStorageKey(item.key, clickhouse);
		await upsertParquetRecord(item.key, new Date());
		imported += 1;
	}

	return { imported, pending: Math.max(pendingItems.length - imported, 0) };
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
