import type { InferSelectModel } from "drizzle-orm";
import type {
	llmEndpointCapabilities,
	llmEndpoints,
	llmEndpointRuntime,
} from "@/db/schema";

export type LlmProvider =
	| "openai"
	| "claude"
	| "openrouter"
	| "vertex-express"
	| "zai";

export type LlmCapability =
	| "matching_primary"
	| "matching_secondary"
	| "categorization_primary"
	| "categorization_secondary";

export type CircuitState = "closed" | "open" | "half_open";

export interface RoutedModelConfig {
	id: string;
	provider: LlmProvider;
	model: string;
	endpoint: string;
	apiKeyEnv: string;
	responseFormat?: "json_object" | "json_schema" | "text" | "none";
	jsonSchemaNullable?: boolean;
	maxTokens?: number;
	weight: number;
	timeoutMs: number;
	maxRetries: number;
}

export interface RoutingCandidate {
	endpoint: InferSelectModel<typeof llmEndpoints>;
	capability: InferSelectModel<typeof llmEndpointCapabilities>;
	runtime: InferSelectModel<typeof llmEndpointRuntime> | null;
	qualityScore: number;
	routingScore: number;
}

export interface RoutingDecision {
	selected: RoutingCandidate;
	candidates: RoutingCandidate[];
	reason: string;
}

export interface EndpointResultMetrics {
	success: boolean;
	latencyMs: number;
	statusCode?: number;
	errorMessage?: string;
}
