import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { validationError } from "@/lib/errors";
import type { CascadeThresholds } from "./types";

const ProviderSchema = z.enum([
	"openai",
	"claude",
	"openrouter",
	"ollama",
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
	ollama: "http://localhost:11434/v1/chat/completions",
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
			case "ollama":
				return "OLLAMA_API_KEY";
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

function enforceEndpointSafety(
	endpoint: string,
	modelId: string,
): Result<void, ReturnType<typeof validationError>> {
	const env = (process.env.NODE_ENV ?? "development").toLowerCase();
	if (env === "development" || env === "test") {
		return ok(undefined);
	}
	if (process.env.ALLOW_LOOPBACK_LLM_ENDPOINT === "true") {
		return ok(undefined);
	}

	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return err(
			validationError({
				message: `Invalid endpoint URL for model ${modelId}: ${endpoint}`,
			}),
		);
	}
	if (!isLoopbackHost(url.hostname)) {
		return ok(undefined);
	}

	return err(
		validationError({
			message: `Unsafe LLM endpoint for model ${modelId}: loopback host '${url.hostname}' is not allowed in ${env} (set ALLOW_LOOPBACK_LLM_ENDPOINT=true to override)`,
		}),
	);
}

export function parseEnsembleConfigSafe(
	raw: string | undefined,
): Result<EnsembleModelConfig[], ReturnType<typeof validationError>> {
	if (!raw || raw.trim().length === 0) {
		return err(validationError({ message: "Model config JSON is required" }));
	}

	let parsed: z.infer<typeof EnsembleSchema>;
	try {
		parsed = EnsembleSchema.parse(JSON.parse(raw));
	} catch (e) {
		return err(
			validationError({
				message: `Invalid model config JSON: ${e instanceof Error ? e.message : String(e)}`,
			}),
		);
	}

	const configs: EnsembleModelConfig[] = [];
	for (const entry of parsed) {
		const endpoint = entry.endpoint ?? DEFAULT_ENDPOINTS[entry.provider];
		const safetyResult = enforceEndpointSafety(endpoint, entry.id);
		if (safetyResult.isErr()) {
			return err(safetyResult.error);
		}
		configs.push({
			...entry,
			endpoint,
			apiKeyEnv: entry.apiKeyEnv ?? defaultApiKeyEnv(entry.provider),
		});
	}
	return ok(configs);
}

export function parseEnsembleConfig(
	raw: string | undefined,
): EnsembleModelConfig[] {
	const result = parseEnsembleConfigSafe(raw);
	if (result.isErr()) {
		throw new Error(result.error.message);
	}
	return result.value;
}

export function readApiKey(config: EnsembleModelConfig): string {
	if (config.provider === "ollama") {
		const envName = config.apiKeyEnv;
		return envName ? (process.env[envName] ?? "") : "";
	}

	const envName = config.apiKeyEnv ?? defaultApiKeyEnv(config.provider);
	const apiKey = process.env[envName];
	if (!apiKey) {
		throw new Error(`Missing API key for model ${config.id}: set ${envName}`);
	}
	return apiKey;
}

export function readApiKeySafe(
	config: EnsembleModelConfig,
): Result<string, ReturnType<typeof validationError>> {
	if (config.provider === "ollama") {
		const envName = config.apiKeyEnv;
		return ok(envName ? (process.env[envName] ?? "") : "");
	}

	const envName = config.apiKeyEnv ?? defaultApiKeyEnv(config.provider);
	const apiKey = process.env[envName];
	if (!apiKey) {
		return err(
			validationError({
				message: `Missing API key for model ${config.id}: set ${envName}`,
			}),
		);
	}
	return ok(apiKey);
}
