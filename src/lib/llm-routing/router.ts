import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
	llmEndpointCapabilities,
	llmEndpointRuntime,
	llmEndpoints,
} from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import {
	loadRoutingCandidates,
	persistEndpointCheck,
	persistRoutingDecision,
	updateEndpointRuntime,
} from "./repository";
import type {
	EndpointResultMetrics,
	LlmCapability,
	RoutingDecision,
	RoutedModelConfig,
} from "./types";

const log = createLogger("matching");

export async function chooseEndpointForCapability(
	capability: LlmCapability,
): Promise<RoutingDecision> {
	const now = new Date();
	const candidates = await loadRoutingCandidates(capability);
	const available = candidates.filter((candidate) => {
		if (!candidate.runtime) {
			return true;
		}
		const cooldownUntil = candidate.runtime.cooldownUntil;
		if (candidate.runtime.circuitState !== "open") {
			return true;
		}
		return cooldownUntil == null || cooldownUntil <= now;
	});

	if (available.length === 0) {
		throw new Error(`No healthy endpoint available for capability ${capability}`);
	}

	const selected = available[0];
	const decision: RoutingDecision = {
		selected,
		candidates: available,
		reason: "top_score",
	};
	await persistRoutingDecision(capability, decision);
	return decision;
}

export function endpointToModelConfig(decision: RoutingDecision): RoutedModelConfig {
	const endpoint = decision.selected.endpoint;
	return {
		id: endpoint.id,
		provider: endpoint.provider as RoutedModelConfig["provider"],
		model: endpoint.model,
		endpoint: endpoint.endpoint,
		apiKeyEnv: endpoint.apiKeyEnv,
		responseFormat: (endpoint.responseFormat ?? undefined) as RoutedModelConfig["responseFormat"],
		jsonSchemaNullable: endpoint.jsonSchemaNullable,
		maxTokens: endpoint.maxTokens ?? undefined,
		weight: endpoint.baseWeight,
		timeoutMs: endpoint.timeoutMs,
		maxRetries: endpoint.maxRetries,
	};
}

export async function recordEndpointResult(
	endpointId: string,
	metrics: EndpointResultMetrics,
): Promise<void> {
	await persistEndpointCheck(endpointId, metrics, "passive");
	await updateEndpointRuntime(endpointId, metrics);
}

export async function validateRoutingConfiguration(): Promise<void> {
	const db = getDb();
	const requiredCapabilities: LlmCapability[] = [
		"matching_primary",
		"matching_secondary",
		"categorization_primary",
		"categorization_secondary",
	];

	const rows = await db
		.select({ capability: llmEndpointCapabilities.capability })
		.from(llmEndpointCapabilities)
		.innerJoin(
			llmEndpoints,
			eq(llmEndpointCapabilities.endpointId, llmEndpoints.id),
		)
		.leftJoin(
			llmEndpointRuntime,
			eq(llmEndpointRuntime.endpointId, llmEndpoints.id),
		)
		.where(
			and(
				eq(llmEndpoints.enabled, true),
				inArray(llmEndpointCapabilities.capability, requiredCapabilities),
				or(
					isNull(llmEndpointRuntime.circuitState),
					eq(llmEndpointRuntime.circuitState, "closed"),
					and(
						eq(llmEndpointRuntime.circuitState, "open"),
						or(
							isNull(llmEndpointRuntime.cooldownUntil),
							lte(llmEndpointRuntime.cooldownUntil, new Date()),
						),
					),
				),
			),
		);

	const available = new Set(rows.map((row) => row.capability));
	const missing = requiredCapabilities.filter((capability) => !available.has(capability));
	if (missing.length > 0) {
		log.error("Routing configuration invalid", { missingCapabilities: missing });
		throw new Error(`Missing LLM endpoint capabilities: ${missing.join(", ")}`);
	}
}
