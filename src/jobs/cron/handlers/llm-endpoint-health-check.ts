import { runActiveHealthChecks } from "@/lib/llm-routing";
import { createLogger } from "@/utils/logger";
import type { CronJobHandler } from "../types";

const log = createLogger("scheduler");

export const llmEndpointHealthCheckHandler: CronJobHandler = {
	async execute(): Promise<[]> {
		const result = await runActiveHealthChecks();
		log.info("Executed LLM endpoint health-check job", result);
		return [];
	},
};
