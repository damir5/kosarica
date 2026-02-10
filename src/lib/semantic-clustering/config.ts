import { z } from "zod";
import type { CascadeThresholds } from "./types";

const ProviderSchema = z.enum(["openai", "claude", "openrouter"]);

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
	}
}

export function parseEnsembleConfig(
	raw: string | undefined,
): EnsembleModelConfig[] {
	if (!raw || raw.trim().length === 0) {
		throw new Error(
			'LLM_ENSEMBLE_JSON is required. Example: [{"id":"fast","provider":"openai","model":"gpt-4o-mini"}]',
		);
	}

	const parsed = EnsembleSchema.parse(JSON.parse(raw));

	return parsed.map((entry) => ({
		...entry,
		endpoint: entry.endpoint ?? DEFAULT_ENDPOINTS[entry.provider],
		apiKeyEnv: entry.apiKeyEnv ?? defaultApiKeyEnv(entry.provider),
	}));
}

export function readApiKey(config: EnsembleModelConfig): string {
	const envName = config.apiKeyEnv ?? defaultApiKeyEnv(config.provider);
	const apiKey = process.env[envName];
	if (!apiKey) {
		throw new Error(`Missing API key for model ${config.id}: set ${envName}`);
	}
	return apiKey;
}
