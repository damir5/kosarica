import { detectCatalogConflicts, summarizeCatalogConflicts } from "@/lib/catalog-validation";
import { createLogger } from "@/utils/logger";
import type { CronExecutionContext, CronJobHandler } from "../types";

const log = createLogger("scheduler");

export const conflictCheckHandler: CronJobHandler = {
	async execute(context: CronExecutionContext): Promise<[]> {
		const conflicts = await detectCatalogConflicts();
		const summary = summarizeCatalogConflicts(conflicts);

		log.info("Catalog conflict check completed", {
			runId: context.runId,
			total: summary.total,
			byType: summary.byType,
		});

		return [];
	},
};
