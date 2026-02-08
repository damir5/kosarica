import { createLogger } from "@/utils/logger";
import {
	type EnsembleModelConfig,
	parseEnsembleConfig,
	readApiKey,
} from "../config";
import { extractJsonPayload } from "../llm";
import {
	buildClusteringPrompt,
	parseClusteringResponse,
} from "./clustering-prompt";
import {
	buildExtractionPrompt,
	parseExtractionResponse,
} from "./extraction-prompt";
import type {
	CandidateGroup,
	ListwiseLLMResult,
	PriceSignal,
	PromptSchema,
	TokenUsage,
} from "./types";

const log = createLogger("matching");

type OpenAiResponseFormatType = "json_object" | "json_schema" | "text";

type OpenAiResponseFormat =
	| { type: "json_object" }
	| { type: "text" }
	| {
			type: "json_schema";
			json_schema: {
				name: string;
				schema: Record<string, unknown>;
			};
	  };

interface ModelCallResult {
	payload: unknown;
	latencyMs: number;
	responseText: string;
	tokenUsage: TokenUsage;
}

const DEFAULT_OPENAI_FORMAT_ORDER: OpenAiResponseFormatType[] = [
	"json_object",
	"json_schema",
	"text",
];

const DEFAULT_OPENAI_FORMAT_ORDER_WITHOUT_SCHEMA: OpenAiResponseFormatType[] = [
	"json_object",
	"text",
];

const responseFormatPreferenceByEndpoint = new Map<
	string,
	OpenAiResponseFormatType
>();

let cachedRawConfig = "__unset__";
let cachedConfigs: EnsembleModelConfig[] = [];

const EMPTY_USAGE: TokenUsage = {
	promptTokens: null,
	completionTokens: null,
	totalTokens: null,
	costUsd: null,
};

function estimateTokens(text: string): number {
	if (text.trim().length === 0) {
		return 0;
	}
	return Math.ceil(text.length / 4);
}

function responseFormatKey(config: EnsembleModelConfig): string {
	return `${config.provider}|${config.model}|${config.endpoint ?? ""}`;
}

function formatFromType(
	type: OpenAiResponseFormatType,
	schema?: PromptSchema,
): OpenAiResponseFormat {
	if (type === "json_schema") {
		if (!schema) {
			return { type: "json_object" };
		}
		return {
			type: "json_schema",
			json_schema: {
				name: schema.name,
				schema: schema.schema,
			},
		};
	}
	return { type };
}

function orderedFormats(
	preferred: OpenAiResponseFormatType | undefined,
	schema?: PromptSchema,
): OpenAiResponseFormat[] {
	const baseOrder = schema
		? DEFAULT_OPENAI_FORMAT_ORDER
		: DEFAULT_OPENAI_FORMAT_ORDER_WITHOUT_SCHEMA;
	if (!preferred || !baseOrder.includes(preferred)) {
		return baseOrder.map((type) => formatFromType(type, schema));
	}

	const order = [preferred, ...baseOrder.filter((type) => type !== preferred)];
	return order.map((type) => formatFromType(type, schema));
}

function isLikelyResponseFormatError(
	status: number,
	bodyText: string,
): boolean {
	if (status !== 400 && status !== 422) {
		return false;
	}
	return /response[_\s-]?format|json_schema|json_object|must be/i.test(
		bodyText,
	);
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}

function addNullable(a: number | null, b: number | null): number | null {
	if (a == null && b == null) {
		return null;
	}
	return (a ?? 0) + (b ?? 0);
}

function extractOpenAiTokenUsage(data: unknown): TokenUsage {
	if (!data || typeof data !== "object") {
		return EMPTY_USAGE;
	}
	const usage = (data as { usage?: Record<string, unknown> }).usage;
	if (!usage) {
		return EMPTY_USAGE;
	}
	return {
		promptTokens: toFiniteNumber(usage.prompt_tokens),
		completionTokens: toFiniteNumber(usage.completion_tokens),
		totalTokens: toFiniteNumber(usage.total_tokens),
		costUsd: toFiniteNumber(usage.cost),
	};
}

function extractOpenAiContent(data: unknown): string {
	if (!data || typeof data !== "object") {
		throw new Error("OpenAI-compatible response body is invalid");
	}

	const choices = (
		data as {
			choices?: Array<{
				message?: {
					content?: unknown;
					parsed?: unknown;
					tool_calls?: Array<{ function?: { arguments?: unknown } }>;
				};
			}>;
		}
	).choices;
	const message = choices?.[0]?.message;
	const content = message?.content;
	if (typeof content === "string") {
		const trimmed = content.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	if (Array.isArray(content)) {
		const text = content
			.map((part) => {
				if (part && typeof part === "object") {
					const maybeText = (part as { text?: unknown }).text;
					if (typeof maybeText === "string") {
						return maybeText;
					}
				}
				return "";
			})
			.join("")
			.trim();
		if (text.length > 0) {
			return text;
		}
	}

	const toolCallArgs = message?.tool_calls
		?.map((toolCall) => toolCall.function?.arguments)
		.find((value): value is string => typeof value === "string")
		?.trim();
	if (toolCallArgs && toolCallArgs.length > 0) {
		return toolCallArgs;
	}

	const parsedPayload = message?.parsed;
	if (parsedPayload && typeof parsedPayload === "object") {
		const serialized = JSON.stringify(parsedPayload);
		if (serialized.trim().length > 0) {
			return serialized;
		}
	}

	throw new Error("No text content in OpenAI-compatible response");
}

async function callOpenAiCompatible(
	config: EnsembleModelConfig,
	systemMsg: string,
	userMsg: string,
	jsonSchema?: PromptSchema,
): Promise<ModelCallResult> {
	const apiKey = readApiKey(config);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	const preferenceKey = responseFormatKey(config);
	const preferred = responseFormatPreferenceByEndpoint.get(preferenceKey);

	try {
		const formats = orderedFormats(preferred, jsonSchema);
		let lastError: Error | null = null;

		for (const [index, format] of formats.entries()) {
			const response = await fetch(config.endpoint ?? "", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: config.model,
					temperature: 0,
					max_tokens: 6000,
					response_format: format,
					messages: [
						{ role: "system", content: systemMsg },
						{ role: "user", content: userMsg },
					],
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				const isLastAttempt = index === formats.length - 1;
				if (
					!isLastAttempt &&
					isLikelyResponseFormatError(response.status, errorBody)
				) {
					log.warn(
						"OpenAI-compatible endpoint rejected response_format; trying fallback",
						{
							model: config.model,
							endpoint: config.endpoint,
							format: format.type,
							status: response.status,
						},
					);
					continue;
				}
				lastError = new Error(
					`${config.provider}:${config.model} HTTP ${response.status} ${response.statusText} body=${errorBody.slice(0, 280)}`,
				);
				break;
			}

			const body = await response.json();
			const isLastAttempt = index === formats.length - 1;
			let content: string;
			let payload: unknown;
			try {
				content = extractOpenAiContent(body);
				payload = extractJsonPayload(content);
			} catch (error) {
				const parseError =
					error instanceof Error ? error.message : String(error);
				if (!isLastAttempt) {
					log.warn(
						"OpenAI-compatible response could not be parsed; trying fallback format",
						{
							model: config.model,
							endpoint: config.endpoint,
							format: format.type,
							parseError,
						},
					);
					continue;
				}
				throw error;
			}
			const tokenUsage = extractOpenAiTokenUsage(body);
			const activeFormat = format.type;
			if (
				responseFormatPreferenceByEndpoint.get(preferenceKey) !== activeFormat
			) {
				responseFormatPreferenceByEndpoint.set(preferenceKey, activeFormat);
				log.info("Updated listwise response_format preference", {
					model: config.model,
					endpoint: config.endpoint,
					preferredResponseFormat: activeFormat,
				});
			}

			return {
				payload,
				latencyMs: 0,
				responseText: content,
				tokenUsage,
			};
		}

		throw lastError ?? new Error("OpenAI-compatible request failed");
	} finally {
		clearTimeout(timeout);
	}
}

async function callClaude(
	config: EnsembleModelConfig,
	systemMsg: string,
	userMsg: string,
): Promise<ModelCallResult> {
	const apiKey = readApiKey(config);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const response = await fetch(config.endpoint ?? "", {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: config.model,
				max_tokens: 6000,
				temperature: 0,
				system: systemMsg,
				messages: [{ role: "user", content: userMsg }],
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`${config.provider}:${config.model} HTTP ${response.status} ${response.statusText} body=${body.slice(0, 280)}`,
			);
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>;
			usage?: {
				input_tokens?: number;
				output_tokens?: number;
			};
		};

		const text = data.content
			?.find((part) => part.type === "text")
			?.text?.trim();
		if (!text) {
			throw new Error("No text content in Claude response");
		}

		return {
			payload: extractJsonPayload(text),
			latencyMs: 0,
			responseText: text,
			tokenUsage: {
				promptTokens: toFiniteNumber(data.usage?.input_tokens),
				completionTokens: toFiniteNumber(data.usage?.output_tokens),
				totalTokens: addNullable(
					toFiniteNumber(data.usage?.input_tokens),
					toFiniteNumber(data.usage?.output_tokens),
				),
				costUsd: null,
			},
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function callModel(
	config: EnsembleModelConfig,
	systemMsg: string,
	userMsg: string,
	jsonSchema?: PromptSchema,
): Promise<
	ModelCallResult & {
		promptTokenEstimate: number;
		responseTokenEstimate: number;
	}
> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
		const startedAt = Date.now();
		try {
			const result =
				config.provider === "claude"
					? await callClaude(config, systemMsg, userMsg)
					: await callOpenAiCompatible(config, systemMsg, userMsg, jsonSchema);

			const latencyMs = Date.now() - startedAt;
			return {
				...result,
				latencyMs,
				promptTokenEstimate: estimateTokens(`${systemMsg}\n${userMsg}`),
				responseTokenEstimate: estimateTokens(result.responseText),
			};
		} catch (error) {
			lastError = error;
			if (attempt < config.maxRetries) {
				await new Promise((resolve) =>
					setTimeout(resolve, 300 * (attempt + 1)),
				);
			}
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`Model call failed for ${config.id}`);
}

export function loadListwiseModelConfigs(
	rawConfig = process.env.LLM_ENSEMBLE_JSON,
): EnsembleModelConfig[] {
	const raw = rawConfig ?? "";
	if (raw !== cachedRawConfig) {
		cachedConfigs = parseEnsembleConfig(raw);
		cachedRawConfig = raw;
	}
	return cachedConfigs;
}

export async function processGroupWithLLM(
	config: EnsembleModelConfig,
	group: CandidateGroup,
	prices: ReadonlyMap<string, PriceSignal>,
): Promise<ListwiseLLMResult> {
	const extractionPrompt = buildExtractionPrompt(
		group.items.map((item) => ({
			id: item.retailerItemId,
			rawName: item.rawName,
		})),
	);

	const extractionCall = await callModel(
		config,
		extractionPrompt.system,
		extractionPrompt.user,
		extractionPrompt.jsonSchema,
	);
	const extraction = parseExtractionResponse(
		extractionCall.payload,
		group.items,
	);
	const specById = new Map(
		extraction.items.map((item) => [item.id, item.spec] as const),
	);

	const clusteringPrompt = buildClusteringPrompt(
		group.items.map((item) => {
			const price = prices.get(item.retailerItemId);
			return {
				id: item.retailerItemId,
				rawName: item.rawName,
				spec: specById.get(item.retailerItemId) ?? {
					brand: item.brand,
					product: item.normalizedName,
					variant: null,
					packCount: item.packAmount,
					unitSize: null,
					unitAmountMlOrG: null,
					container: item.containerType,
					totalQuantity: item.packAmount,
					totalAmountMlOrG: null,
				},
				medianPriceEur: price ? price.medianPriceCents / 100 : null,
				chainSlug: item.chainSlug,
			};
		}),
	);

	const clusteringCall = await callModel(
		config,
		clusteringPrompt.system,
		clusteringPrompt.user,
		clusteringPrompt.jsonSchema,
	);
	const clustering = parseClusteringResponse(
		clusteringCall.payload,
		group.items,
	);

	return {
		modelId: config.id,
		provider: config.provider,
		groupId: group.groupId,
		extraction,
		clustering,
		extractionLatencyMs: extractionCall.latencyMs,
		clusteringLatencyMs: clusteringCall.latencyMs,
		totalLatencyMs: extractionCall.latencyMs + clusteringCall.latencyMs,
		tokenEstimates: {
			extractionPrompt: extractionCall.promptTokenEstimate,
			extractionResponse: extractionCall.responseTokenEstimate,
			clusteringPrompt: clusteringCall.promptTokenEstimate,
			clusteringResponse: clusteringCall.responseTokenEstimate,
			total:
				extractionCall.promptTokenEstimate +
				extractionCall.responseTokenEstimate +
				clusteringCall.promptTokenEstimate +
				clusteringCall.responseTokenEstimate,
		},
		tokenUsage: {
			extraction: extractionCall.tokenUsage,
			clustering: clusteringCall.tokenUsage,
			total: {
				promptTokens: addNullable(
					extractionCall.tokenUsage.promptTokens,
					clusteringCall.tokenUsage.promptTokens,
				),
				completionTokens: addNullable(
					extractionCall.tokenUsage.completionTokens,
					clusteringCall.tokenUsage.completionTokens,
				),
				totalTokens: addNullable(
					extractionCall.tokenUsage.totalTokens,
					clusteringCall.tokenUsage.totalTokens,
				),
				costUsd: addNullable(
					extractionCall.tokenUsage.costUsd,
					clusteringCall.tokenUsage.costUsd,
				),
			},
		},
	};
}
