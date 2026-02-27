import * as z from "zod";
import {
	getClickHouseSyncStatus,
	loadAllToClickHouse,
	loadMissingToClickHouse,
} from "@/ingestion/clickhouse-sync";
import { scheduleTask } from "@/lib/taskqueue";
import { superadminProcedure } from "../base";

export const loadAll = superadminProcedure
	.input(z.object({}).optional())
	.handler(async () => {
		return loadAllToClickHouse();
	});

export const loadMissing = superadminProcedure
	.input(z.object({}).optional())
	.handler(async () => {
		return loadMissingToClickHouse();
	});

export const status = superadminProcedure
	.input(z.object({}).optional())
	.handler(async () => {
		return getClickHouseSyncStatus();
	});

export const startSync = superadminProcedure
	.input(
		z.object({
			mode: z.enum(["missing", "all"]).default("missing"),
			priority: z.number().optional().default(12),
		}),
	)
	.handler(async ({ input }) => {
		const { id } = await scheduleTask({
			taskType: "clickhouse",
			priority: input.priority ?? 0,
			payload: {
				type: "clickhouseSync",
				mode: input.mode,
			},
		});
		return { taskId: id };
	});
