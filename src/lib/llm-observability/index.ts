import { createHash } from "node:crypto";
import { llmDecisionLog } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import type { LogLlmDecisionInput, LogLlmDecisionResult } from "./types";

const log = createLogger("matching");

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
		a.localeCompare(b),
	);
	return `{${entries
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
		.join(",")}}`;
}

function buildInputHash(taskType: string, input: Record<string, unknown>): string {
	return createHash("sha256")
		.update(`${taskType}:${stableJson(input)}`)
		.digest("hex");
}

export async function logLlmDecision(
	input: LogLlmDecisionInput,
): Promise<LogLlmDecisionResult> {
	const db = getDb();
	const inputHash = buildInputHash(input.taskType, input.input);
	const [row] = await db
		.insert(llmDecisionLog)
		.values({
			taskType: input.taskType,
			inputHash,
			input: input.input,
			output: input.output ?? null,
			modelId: input.modelId,
			provider: input.provider,
			latencyMs: input.latencyMs ?? null,
			tokenCount: input.tokenCount ?? null,
			costCents: input.costCents ?? null,
			verdict: input.verdict ?? null,
			confidence: input.confidence ?? null,
			reasoning: input.reasoning ?? null,
			humanOverride: input.humanOverride ?? null,
			humanNotes: input.humanNotes ?? null,
			reviewedBy: input.reviewedBy ?? null,
			reviewedAt: input.reviewedAt ?? null,
			createdAt: new Date(),
		})
		.returning({ id: llmDecisionLog.id });

	log.debug("LLM decision logged", {
		id: row.id,
		taskType: input.taskType,
		modelId: input.modelId,
		provider: input.provider,
	});

	return {
		id: row.id,
		inputHash,
	};
}

export type { LogLlmDecisionInput, LogLlmDecisionResult } from "./types";
