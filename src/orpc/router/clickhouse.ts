import * as z from "zod";
import {
	getClickHouseSyncStatus,
	loadAllToClickHouse,
	loadMissingToClickHouse,
} from "@/ingestion/clickhouse-sync";
import { procedure } from "../base";

export const loadAll = procedure
	.input(z.object({}).optional())
	.handler(async () => {
		return loadAllToClickHouse();
	});

export const loadMissing = procedure
	.input(z.object({}).optional())
	.handler(async () => {
		return loadMissingToClickHouse();
	});

export const status = procedure
	.input(z.object({}).optional())
	.handler(async () => {
		return getClickHouseSyncStatus();
	});
