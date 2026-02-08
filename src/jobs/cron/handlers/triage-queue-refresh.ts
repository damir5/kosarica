import { refreshBarcodeTriageQueue } from "@/lib/barcode-anchoring";
import { createLogger } from "@/utils/logger";
import type { CronExecutionContext, CronJobHandler } from "../types";

const log = createLogger("scheduler");

export const triageQueueRefreshHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		await refreshBarcodeTriageQueue();
		log.info("Refreshed barcode triage queue materialized view", {
			runId: context.runId,
		});
		return [];
	},
};
