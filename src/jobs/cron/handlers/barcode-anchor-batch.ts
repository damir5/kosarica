import { createLogger } from "@/utils/logger";
import type {
	CronExecutionContext,
	CronJobHandler,
	TaskToEnqueue,
} from "../types";

const log = createLogger("scheduler");

export const barcodeAnchorBatchHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<TaskToEnqueue[]> {
		log.info("Queueing barcode anchoring batch task", {
			runId: context.runId,
			scheduledFor: context.scheduledFor.toISOString(),
		});

		return [
			{
				type: "barcode-anchor",
				payload: {
					minChains: 2,
					dryRun: false,
				},
				idempotencyKey: `barcode-anchor:${context.scheduledFor.toISOString()}`,
			},
		];
	},
};
