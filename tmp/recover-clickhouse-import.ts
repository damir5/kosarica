import 'dotenv/config';
import { isNotNull } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { parquetFiles } from '@/db/schema';
import { getClickHouse } from '@/lib/clickhouse';
import { getStorage, resolveStoragePath } from '@/lib/storage';

function parseParquetKey(storageKey: string): { chainSlug: string; targetDate: string } {
  const match = storageKey.match(/^parquet\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/prices\.parquet$/);
  if (!match) {
    throw new Error(`Invalid parquet storage key: ${storageKey}`);
  }
  const [, chainSlug, targetDate] = match;
  return { chainSlug, targetDate };
}

async function upsertImported(storageKey: string, importedAt: Date): Promise<void> {
  const db = getDatabase();
  const storage = getStorage();
  const info = await storage.getInfo(storageKey);
  const { chainSlug, targetDate } = parseParquetKey(storageKey);

  await db
    .insert(parquetFiles)
    .values({
      chainSlug,
      targetDate,
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
        targetDate,
        fileSize: info.size,
        checksum: info.checksum,
        importedAt,
        updatedAt: new Date(),
      },
    });
}

async function main() {
  const db = getDatabase();
  const storage = getStorage();
  const clickhouse = getClickHouse();

  const keys = (await storage.list('parquet/')).filter((key) => key.endsWith('.parquet'));

  const importedRows = await db
    .select({ storageKey: parquetFiles.storageKey })
    .from(parquetFiles)
    .where(isNotNull(parquetFiles.importedAt));
  const importedSet = new Set(importedRows.map((row) => row.storageKey));

  const missing = keys.filter((key) => !importedSet.has(key));

  let imported = 0;
  let skippedCorrupt = 0;
  const skippedKeys: string[] = [];

  for (const key of missing) {
    const filePath = resolveStoragePath(key);
    try {
      await clickhouse.importParquetFile(filePath);
      await upsertImported(key, new Date());
      imported += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Parquet magic bytes not found')) {
        await upsertImported(key, new Date());
        skippedCorrupt += 1;
        skippedKeys.push(key);
        continue;
      }
      throw error;
    }
  }

  const totalImportedRows = await db
    .select({ storageKey: parquetFiles.storageKey })
    .from(parquetFiles)
    .where(isNotNull(parquetFiles.importedAt));

  console.log(
    JSON.stringify(
      {
        totalParquetFiles: keys.length,
        importedNow: imported,
        skippedCorrupt,
        skippedKeys,
        importedTotal: totalImportedRows.length,
        pendingAfter: keys.length - totalImportedRows.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
