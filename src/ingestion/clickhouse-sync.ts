import { inArray } from "drizzle-orm";
import { getDatabase } from "@/db";
import { parquetFiles } from "@/db/schema";
import { getClickHouse } from "@/lib/clickhouse";
import { getStorage, resolveStoragePath } from "@/lib/storage";

export interface ClickHouseSyncStatus {
	totalFiles: number;
	importedFiles: number;
	pendingFiles: number;
	lastImportedAt?: Date | null;
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
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: parquetFiles.storageKey,
			set: {
				chainSlug,
				targetDate: targetDateStr,
				fileSize: info.size,
				checksum: info.checksum,
				importedAt,
				updatedAt: new Date(),
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

export async function loadAllToClickHouse(): Promise<{
	imported: number;
}> {
	const clickhouse = getClickHouse();
	const keys = await listParquetKeys();

	await clickhouse.truncatePrices();

	let imported = 0;
	for (const key of keys) {
		const filePath = resolveStoragePath(key);
		await clickhouse.importParquetFile(filePath);
		await upsertParquetRecord(key, new Date());
		imported += 1;
	}

	return { imported };
}

export async function loadMissingToClickHouse(): Promise<{
	imported: number;
	pending: number;
}> {
	const clickhouse = getClickHouse();
	const keys = await listParquetKeys();
	const stateByKey = await loadParquetImportState(keys);
	const pendingKeys = keys.filter((key) => {
		const state = stateByKey.get(key);
		if (!state) {
			return true;
		}
		if (!state.importedAt) {
			return true;
		}
		return state.updatedAt > state.importedAt;
	});

	let imported = 0;
	for (const key of pendingKeys) {
		const { chainSlug, targetDate } = parseParquetKey(key);
		// Always clear an existing chain/day snapshot before import so sync is idempotent,
		// even when parquet_files.imported_at is missing or stale.
		await clickhouse.deleteSnapshot(
			chainSlug,
			targetDate.toISOString().slice(0, 10),
		);

		const filePath = resolveStoragePath(key);
		await clickhouse.importParquetFile(filePath);
		await upsertParquetRecord(key, new Date());
		imported += 1;
	}

	return { imported, pending: Math.max(pendingKeys.length - imported, 0) };
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
