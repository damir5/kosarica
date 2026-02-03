import { isNotNull, sql } from "drizzle-orm";
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

	const targetDateStr = targetDate.toISOString().split('T')[0];
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
	const db = getDatabase();
	const keys = await listParquetKeys();

	const importedRows = await db
		.select({ storageKey: parquetFiles.storageKey })
		.from(parquetFiles)
		.where(isNotNull(parquetFiles.importedAt));

	const importedSet = new Set(importedRows.map((row) => row.storageKey));
	const missing = keys.filter((key) => !importedSet.has(key));

	let imported = 0;
	for (const key of missing) {
		const filePath = resolveStoragePath(key);
		await clickhouse.importParquetFile(filePath);
		await upsertParquetRecord(key, new Date());
		imported += 1;
	}

	return { imported, pending: 0 };
}

export async function getClickHouseSyncStatus(): Promise<ClickHouseSyncStatus> {
	const db = getDatabase();
	const keys = await listParquetKeys();

	const [{ importedCount, lastImportedAt } = { importedCount: 0, lastImportedAt: null }] =
		await db
			.select({
				importedCount: sql<number>`count(${parquetFiles.id})`,
				lastImportedAt: sql<Date | null>`max(${parquetFiles.importedAt})`,
			})
			.from(parquetFiles)
			.where(isNotNull(parquetFiles.importedAt));

	const importedFiles = Number(importedCount ?? 0);
	const totalFiles = keys.length;
	const pendingFiles = Math.max(totalFiles - importedFiles, 0);

	return {
		totalFiles,
		importedFiles,
		pendingFiles,
		lastImportedAt,
	};
}
