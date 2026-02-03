#!/usr/bin/env tsx
import { config } from "dotenv";
import {
	getClickHouseSyncStatus,
	loadAllToClickHouse,
	loadMissingToClickHouse,
} from "@/ingestion/clickhouse-sync";

const nodeEnv = process.env.NODE_ENV || "development";
config({ path: `.env.${nodeEnv}` });
config();

async function main() {
	const mode = process.argv[2];

	switch (mode) {
		case "all": {
			const result = await loadAllToClickHouse();
			console.log(`Imported ${result.imported} parquet file(s).`);
			break;
		}
		case "missing": {
			const result = await loadMissingToClickHouse();
			console.log(
				`Imported ${result.imported} parquet file(s). Pending ${result.pending}.`,
			);
			break;
		}
		case "status": {
			const status = await getClickHouseSyncStatus();
			console.log(
				`Parquet files: total=${status.totalFiles}, imported=${status.importedFiles}, pending=${status.pendingFiles}`,
			);
			if (status.lastImportedAt) {
				console.log(`Last import: ${status.lastImportedAt.toISOString()}`);
			}
			break;
		}
		default:
			console.error(
				"Usage: pnpm clickhouse:load-all | pnpm clickhouse:load-missing | pnpm clickhouse:status",
			);
			process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
