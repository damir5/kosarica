import { z } from "zod";
import type { CascadeThresholds } from "./types";

const ProviderSchema = z.enum([
	"openai",
	"claude",
	"openrouter",
	"vertex-express",
	"nvidia-nim",
	"zai",
]);

const ResponseFormatSchema = z.enum([
	"json_object",
	"json_schema",
	"text",
	"none",
]);

const EnsembleModelSchema = z.object({
	id: z.string().min(1),
	provider: ProviderSchema,
	model: z.string().min(1),
	endpoint: z.string().url().optional(),
	apiKeyEnv: z.string().min(1).optional(),
	responseFormat: ResponseFormatSchema.optional(),
	jsonSchemaNullable: z.boolean().optional(),
	maxTokens: z.number().int().positive().optional(),
	weight: z.number().positive().default(1),
	timeoutMs: z.number().int().positive().default(20_000),
	maxRetries: z.number().int().min(0).max(5).default(1),
});

const EnsembleSchema = z.array(EnsembleModelSchema).min(1);

export type EnsembleModelConfig = z.infer<typeof EnsembleModelSchema>;

const DEFAULT_ENDPOINTS: Record<EnsembleModelConfig["provider"], string> = {
	openai: "https://api.openai.com/v1/chat/completions",
	openrouter: "https://openrouter.ai/api/v1/chat/completions",
	claude: "https://api.anthropic.com/v1/messages",
	"vertex-express": "https://aiplatform.googleapis.com/v1",
	"nvidia-nim": "https://integrate.api.nvidia.com/v1/chat/completions",
	zai: "https://api.z.ai/api/coding/paas/v4/chat/completions",
};

export const STRICT_CASCADE_THRESHOLDS: CascadeThresholds = {
	escalateThreshold: 0.92,
	autoApproveConfidence: 0.95,
	autoRejectConfidence: 0.8,
	reviewFloor: 0.8,
	minConsensusForAutomation: 0.66,
};

function defaultApiKeyEnv(provider: EnsembleModelConfig["provider"]): string {
	switch (provider) {
		case "openai":
			return "OPENAI_API_KEY";
		case "openrouter":
			return "OPENROUTER_API_KEY";
		case "claude":
			return "ANTHROPIC_API_KEY";
		case "vertex-express":
			return "VERTEX_EXPRESS_API_KEY";
		case "nvidia-nim":
			return "NIM_API_KEY";
		case "zai":
			return "ZAI_API_KEY";
	}
}

function isLoopbackHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return (
		normalized === "localhost" ||
		normalized === "127.0.0.1" ||
		normalized === "::1"
	);
}

function enforceEndpointSafety(endpoint: string, modelId: string): void {
	const env = (process.env.NODE_ENV ?? "development").toLowerCase();
	if (env === "development" || env === "test") {
		return;
	}
	if (process.env.ALLOW_LOOPBACK_LLM_ENDPOINT === "true") {
		return;
	}

	const url = new URL(endpoint);
	if (!isLoopbackHost(url.hostname)) {
		return;
	}

	throw new Error(
		`Unsafe LLM endpoint for model ${modelId}: loopback host '${url.hostname}' is not allowed in ${env} (set ALLOW_LOOPBACK_LLM_ENDPOINT=true to override)`,
	);
}

export function parseEnsembleConfig(
	raw: string | undefined,
): EnsembleModelConfig[] {
	if (!raw || raw.trim().length === 0) {
		throw new Error("Model config JSON is required");
	}

	const parsed = EnsembleSchema.parse(JSON.parse(raw));

	return parsed.map((entry) => {
		const endpoint = entry.endpoint ?? DEFAULT_ENDPOINTS[entry.provider];
		enforceEndpointSafety(endpoint, entry.id);
		return {
			...entry,
			endpoint,
			apiKeyEnv: entry.apiKeyEnv ?? defaultApiKeyEnv(entry.provider),
		};
	});
}

export function readApiKey(config: EnsembleModelConfig): string {
	const envName = config.apiKeyEnv ?? defaultApiKeyEnv(config.provider);
	const apiKey = process.env[envName];
	if (!apiKey) {
		throw new Error(`Missing API key for model ${config.id}: set ${envName}`);
	}
	return apiKey;
}
