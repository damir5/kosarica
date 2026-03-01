import { createLogger } from "@/utils/logger";
import {
	type EnsembleModelConfig,
	readApiKeySafe,
} from "../config";
import {
	extractJsonPayload,
	extractJsonPayloadSafe,
} from "../llm";
import {
	callVertexExpressGenerateContent,
	type VertexExpressUsage,
} from "@/lib/llm/vertex-express";
import { llmError } from "@/lib/errors";
import { err, ok, type Result } from "neverthrow";
import {
	buildClusteringPrompt,
	buildBulkClusteringPrompt,
	parseClusteringResponse,
	parseBulkClusteringResponse,
} from "./clustering-prompt";
import {
	buildExtractionPrompt,
	buildBulkExtractionPrompt,
	parseExtractionResponse,
	parseBulkExtractionResponse,
} from "./extraction-prompt";
import type {
	CandidateGroup,
	ListwiseLLMResult,
	PriceSignal,
	PromptSchema,
	TokenUsage,
} from "./types";

const log = createLogger("matching");

type OpenAiResponseFormatType = "json_object" | "json_schema" | "text" | "none";

type OpenAiResponseFormat =
	| { type: "json_object" }
	| { type: "text" }
	| { type: "none" }
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

type ListwisePromptStage = "extraction" | "clustering";

type ListwisePromptPayload = {
	stage: ListwisePromptStage;
	system: string;
	user: string;
	jsonSchema?: PromptSchema;
	modelId: string;
	model: string;
	provider: EnsembleModelConfig["provider"];
	endpoint?: string;
	groupId: string;
};

type ListwisePromptHook = (payload: ListwisePromptPayload) => void;

let listwisePromptHook: ListwisePromptHook | null = null;

export function setListwisePromptHook(hook: ListwisePromptHook | null): void {
	listwisePromptHook = hook;
}

function emitListwisePrompt(payload: ListwisePromptPayload): void {
	if (listwisePromptHook) {
		listwisePromptHook(payload);
	}
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
	if (type === "none") {
		return { type: "none" };
	}
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

function normalizeJsonSchema(
	schema: PromptSchema,
	options: { nullable: boolean },
): PromptSchema {
	const normalizeSchemaNode = (value: unknown): unknown => {
		if (Array.isArray(value)) {
			return value.map((entry) => normalizeSchemaNode(entry));
		}
		if (!value || typeof value !== "object") {
			return value;
		}
		const record = value as Record<string, unknown>;
		const normalized: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(record)) {
			if (key === "type") {
				continue;
			}
			normalized[key] = normalizeSchemaNode(entry);
		}
		const typeValue = record.type;
		if (
			Array.isArray(typeValue) &&
			typeValue.every((entry) => typeof entry === "string")
		) {
			return {
				anyOf: typeValue.map((entry) => ({
					...normalized,
					type: entry,
				})),
			};
		}
		if (typeof typeValue === "string") {
			return {
				...normalized,
				type: typeValue,
			};
		}
		return normalized;
	};

	const normalizedSchema = normalizeSchemaNode(schema.schema);
	const nullableWrapped = options.nullable
		? { anyOf: [normalizedSchema, { type: "null" }] }
		: normalizedSchema;

	return {
		name: schema.name,
		schema: nullableWrapped as Record<string, unknown>,
	};
}

function orderedFormats(
	preferred: OpenAiResponseFormatType | undefined,
	schema?: PromptSchema,
): OpenAiResponseFormat[] {
	if (preferred === "none") {
		return [{ type: "none" }];
	}
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

function divNullable(value: number | null, divisor: number): number | null {
	if (value == null) return null;
	if (!Number.isFinite(value) || divisor <= 0) return null;
	return Math.floor(value / divisor);
}

function splitTokenUsage(usage: TokenUsage, parts: number): TokenUsage {
	return {
		promptTokens: divNullable(usage.promptTokens, parts),
		completionTokens: divNullable(usage.completionTokens, parts),
		totalTokens: divNullable(usage.totalTokens, parts),
		costUsd: divNullable(usage.costUsd, parts),
	};
}

function splitEstimate(value: number, parts: number): number {
	if (!Number.isFinite(value) || value <= 0 || parts <= 1) {
		return value;
	}
	return Math.ceil(value / parts);
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

function extractVertexTokenUsage(usage: VertexExpressUsage): TokenUsage {
	return {
		promptTokens: usage.promptTokens,
		completionTokens: usage.completionTokens,
		totalTokens: usage.totalTokens,
		costUsd: null,
	};
}

function extractOpenAiContentSafe(
	provider: string,
	data: unknown,
): Result<string, ReturnType<typeof llmError>> {
	if (!data || typeof data !== "object") {
		return err(
			llmError({ provider, message: "OpenAI-compatible response body is invalid" }),
		);
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
			return ok(trimmed);
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
			return ok(text);
		}
	}

	const toolCallArgs = message?.tool_calls
		?.map((toolCall) => toolCall.function?.arguments)
		.find((value): value is string => typeof value === "string")
		?.trim();
	if (toolCallArgs && toolCallArgs.length > 0) {
		return ok(toolCallArgs);
	}

	const parsedPayload = message?.parsed;
	if (parsedPayload && typeof parsedPayload === "object") {
		const serialized = JSON.stringify(parsedPayload);
		if (serialized.trim().length > 0) {
			return ok(serialized);
		}
	}

	return err(
		llmError({ provider, message: "No text content in OpenAI-compatible response" }),
	);
}

function toOllamaChatEndpoint(endpoint: string): string {
	return endpoint.replace(/\/v1\/chat\/completions\/?$/i, "/api/chat");
}

function extractOllamaContentSafe(
	data: unknown,
): Result<string, ReturnType<typeof llmError>> {
	if (!data || typeof data !== "object") {
		return err(llmError({ provider: "ollama", message: "Ollama response body is invalid" }));
	}
	const message = (data as { message?: { content?: unknown } }).message;
	const content = message?.content;
	if (typeof content === "string") {
		const trimmed = content.trim();
		if (trimmed.length > 0) {
			return ok(trimmed);
		}
	}
	return err(llmError({ provider: "ollama", message: "No text content in Ollama response" }));
}

function extractOllamaTokenUsage(data: unknown): TokenUsage {
	if (!data || typeof data !== "object") {
		return EMPTY_USAGE;
	}
	const payload = data as {
		prompt_eval_count?: unknown;
		eval_count?: unknown;
	};
	const promptTokens = toFiniteNumber(payload.prompt_eval_count);
	const completionTokens = toFiniteNumber(payload.eval_count);
	return {
		promptTokens,
		completionTokens,
		totalTokens: addNullable(promptTokens, completionTokens),
		costUsd: null,
	};
}

async function callVertexExpress(
	config: EnsembleModelConfig,
	systemMsg: string,
	userMsg: string,
	jsonSchema?: PromptSchema,
): Promise<ModelCallResult> {
	const normalizedSchema = jsonSchema
		? normalizeJsonSchema(jsonSchema, {
				nullable: config.jsonSchemaNullable === true,
			})
		: undefined;

	const result = await callVertexExpressGenerateContent({
		config,
		systemMsg,
		userMsg,
		responseMimeType: "application/json",
		responseSchema: normalizedSchema?.schema,
	});

	return {
		payload: extractJsonPayload(result.responseText),
		latencyMs: 0,
		responseText: result.responseText,
		tokenUsage: extractVertexTokenUsage(result.usage),
	};
}

async function callOpenAiCompatible(
	config: EnsembleModelConfig,
	systemMsg: string,
	userMsg: string,
	jsonSchema?: PromptSchema,
): Promise<ModelCallResult> {
	const apiKeyResult = readApiKeySafe(config);
	if (apiKeyResult.isErr()) {
		throw new Error(apiKeyResult.error.message);
	}
	const apiKey = apiKeyResult.value;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (apiKey.length > 0) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	if (config.provider === "openrouter") {
		headers["HTTP-Referer"] =
			process.env.OPENROUTER_HTTP_REFERER ?? "https://kosarica.local";
		headers["X-Title"] =
			process.env.OPENROUTER_X_TITLE ?? "Kosarica Semantic Clustering";
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	const preferenceKey = responseFormatKey(config);
	const preferred =
		config.responseFormat ??
		responseFormatPreferenceByEndpoint.get(preferenceKey);
	const normalizedSchema = jsonSchema
		? normalizeJsonSchema(jsonSchema, {
				nullable: config.jsonSchemaNullable === true,
			})
		: undefined;

	try {
		const formats = orderedFormats(preferred, normalizedSchema);
		let lastError: Error | null = null;

		for (const [index, format] of formats.entries()) {
			const responseFormat = format.type === "none" ? undefined : format;
			const response = await fetch(config.endpoint ?? "", {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: config.model,
					temperature: 0,
					max_tokens: config.maxTokens ?? 6000,
					...(responseFormat ? { response_format: responseFormat } : {}),
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
					if (process.env.LISTWISE_DEBUG_RESPONSES === "1") {
						log.warn("Response_format rejection body", {
							model: config.model,
							endpoint: config.endpoint,
							format: format.type,
							status: response.status,
							errorSnippet: errorBody.slice(0, 800),
						});
					}
					continue;
				}
				lastError = new Error(
					`${config.provider}:${config.model} HTTP ${response.status} ${response.statusText} body=${errorBody.slice(0, 280)}`,
				);
				break;
			}

			const body = await response.json();
			const isLastAttempt = index === formats.length - 1;
			let content: string | null = null;
			let payload: unknown;

			const contentResult = extractOpenAiContentSafe(config.provider, body);
			if (contentResult.isErr()) {
				const parseError = contentResult.error.message;
				if (process.env.LISTWISE_DEBUG_RESPONSES === "1") {
					const fallbackContent = (() => {
						const fallback = extractOpenAiContentSafe(config.provider, body);
						return fallback.isErr() ? null : fallback.value;
					})();
					log.warn("Listwise response parse failed", {
						model: config.model,
						endpoint: config.endpoint,
						format: format.type,
						parseError,
						responseSnippet:
							(content ?? fallbackContent)?.slice(0, 1200) ?? null,
					});
				}
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
				throw new Error(parseError);
			}
			content = contentResult.value;

			const payloadResult = extractJsonPayloadSafe(content);
			if (payloadResult.isErr()) {
				const parseError = payloadResult.error.message;
				if (!isLastAttempt) {
					log.warn(
						"OpenAI-compatible response JSON could not be parsed; trying fallback format",
						{
							model: config.model,
							endpoint: config.endpoint,
							format: format.type,
							parseError,
						},
					);
					continue;
				}
				throw new Error(parseError);
			}
			payload = payloadResult.value;

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

async function callOllamaNative(
	config: EnsembleModelConfig,
	systemMsg: string,
	userMsg: string,
): Promise<ModelCallResult> {
	const apiKeyResult = readApiKeySafe(config);
	if (apiKeyResult.isErr()) {
		throw new Error(apiKeyResult.error.message);
	}
	const apiKey = apiKeyResult.value;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (apiKey.length > 0) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const response = await fetch(toOllamaChatEndpoint(config.endpoint ?? ""), {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: config.model,
				stream: false,
				options: { temperature: 0 },
				messages: [
					{ role: "system", content: systemMsg },
					{ role: "user", content: userMsg },
				],
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`${config.provider}:${config.model} HTTP ${response.status} ${response.statusText} body=${body.slice(0, 280)}`,
			);
		}

		const data = await response.json();
		const textResult = extractOllamaContentSafe(data);
		if (textResult.isErr()) {
			throw new Error(textResult.error.message);
		}
		const text = textResult.value;
		const payloadResult = extractJsonPayloadSafe(text);
		if (payloadResult.isErr()) {
			throw new Error(payloadResult.error.message);
		}
		return {
			payload: payloadResult.value,
			latencyMs: 0,
			responseText: text,
			tokenUsage: extractOllamaTokenUsage(data),
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function callClaude(
	config: EnsembleModelConfig,
	systemMsg: string,
	userMsg: string,
): Promise<ModelCallResult> {
	const apiKeyResult = readApiKeySafe(config);
	if (apiKeyResult.isErr()) {
		throw new Error(apiKeyResult.error.message);
	}
	const apiKey = apiKeyResult.value;
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

		const payloadResult = extractJsonPayloadSafe(text);
		if (payloadResult.isErr()) {
			throw new Error(payloadResult.error.message);
		}
		return {
			payload: payloadResult.value,
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

export async function callModelSafe(
	config: EnsembleModelConfig,
	systemMsg: string,
	userMsg: string,
	jsonSchema?: PromptSchema,
): Promise<
	Result<
		ModelCallResult & {
			promptTokenEstimate: number;
			responseTokenEstimate: number;
		},
		ReturnType<typeof llmError>
	>
> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
		const startedAt = Date.now();
		try {
			const result =
				config.provider === "claude"
					? await callClaude(config, systemMsg, userMsg)
					: config.provider === "vertex-express"
						? await callVertexExpress(config, systemMsg, userMsg, jsonSchema)
						: config.provider === "ollama"
							? await callOllamaNative(config, systemMsg, userMsg)
						: await callOpenAiCompatible(config, systemMsg, userMsg, jsonSchema);

			const latencyMs = Date.now() - startedAt;
			return ok({
				...result,
				latencyMs,
				promptTokenEstimate: estimateTokens(`${systemMsg}\n${userMsg}`),
				responseTokenEstimate: estimateTokens(result.responseText),
			});
		} catch (error) {
			lastError = error;
			if (attempt < config.maxRetries) {
				await new Promise((resolve) =>
					setTimeout(resolve, 300 * (attempt + 1)),
				);
			}
		}
	}

	return err(
		llmError({
			provider: config.provider,
			message:
				lastError instanceof Error
					? lastError.message
					: `Model call failed for ${config.id}`,
			cause: lastError,
		}),
	);
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
	emitListwisePrompt({
		stage: "extraction",
		system: extractionPrompt.system,
		user: extractionPrompt.user,
		jsonSchema: extractionPrompt.jsonSchema,
		modelId: config.id,
		model: config.model,
		provider: config.provider,
		endpoint: config.endpoint,
		groupId: group.groupId,
	});

	const extractionCallResult = await callModelSafe(
		config,
		extractionPrompt.system,
		extractionPrompt.user,
		extractionPrompt.jsonSchema,
	);
	if (extractionCallResult.isErr()) {
		throw new Error(extractionCallResult.error.message);
	}
	const extractionCall = extractionCallResult.value;
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
	emitListwisePrompt({
		stage: "clustering",
		system: clusteringPrompt.system,
		user: clusteringPrompt.user,
		jsonSchema: clusteringPrompt.jsonSchema,
		modelId: config.id,
		model: config.model,
		provider: config.provider,
		endpoint: config.endpoint,
		groupId: group.groupId,
	});

	const clusteringCallResult = await callModelSafe(
		config,
		clusteringPrompt.system,
		clusteringPrompt.user,
		clusteringPrompt.jsonSchema,
	);
	if (clusteringCallResult.isErr()) {
		throw new Error(clusteringCallResult.error.message);
	}
	const clusteringCall = clusteringCallResult.value;
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

export async function processGroupsWithLLM(
	config: EnsembleModelConfig,
	groups: readonly CandidateGroup[],
	prices: ReadonlyMap<string, PriceSignal>,
): Promise<ListwiseLLMResult[]> {
	if (groups.length === 0) {
		return [];
	}
	if (groups.length === 1) {
		return [await processGroupWithLLM(config, groups[0], prices)];
	}

	const bulkLabel = `bulk:${groups[0].groupId}+${groups.length - 1}`;

	const extractionPrompt = buildBulkExtractionPrompt(
		groups.map((group) => ({
			groupId: group.groupId,
			items: group.items.map((item) => ({
				id: item.retailerItemId,
				rawName: item.rawName,
			})),
		})),
	);
	emitListwisePrompt({
		stage: "extraction",
		system: extractionPrompt.system,
		user: extractionPrompt.user,
		jsonSchema: extractionPrompt.jsonSchema,
		modelId: config.id,
		model: config.model,
		provider: config.provider,
		endpoint: config.endpoint,
		groupId: bulkLabel,
	});

	const extractionCallResult = await callModelSafe(
		config,
		extractionPrompt.system,
		extractionPrompt.user,
		extractionPrompt.jsonSchema,
	);
	if (extractionCallResult.isErr()) {
		throw new Error(extractionCallResult.error.message);
	}
	const extractionCall = extractionCallResult.value;
	const extractionByGroup = parseBulkExtractionResponse(
		extractionCall.payload,
		groups.map((group) => ({ groupId: group.groupId, items: group.items })),
	);

	const clusteringPrompt = buildBulkClusteringPrompt(
		groups.map((group) => {
			const extraction = extractionByGroup.get(group.groupId);
			const specById = new Map(
				(extraction?.items ?? []).map((item) => [item.id, item.spec] as const),
			);

			return {
				groupId: group.groupId,
				items: group.items.map((item) => {
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
			};
		}),
	);
	emitListwisePrompt({
		stage: "clustering",
		system: clusteringPrompt.system,
		user: clusteringPrompt.user,
		jsonSchema: clusteringPrompt.jsonSchema,
		modelId: config.id,
		model: config.model,
		provider: config.provider,
		endpoint: config.endpoint,
		groupId: bulkLabel,
	});

	const clusteringCallResult = await callModelSafe(
		config,
		clusteringPrompt.system,
		clusteringPrompt.user,
		clusteringPrompt.jsonSchema,
	);
	if (clusteringCallResult.isErr()) {
		throw new Error(clusteringCallResult.error.message);
	}
	const clusteringCall = clusteringCallResult.value;
	const clusteringByGroup = parseBulkClusteringResponse(
		clusteringCall.payload,
		groups.map((group) => ({ groupId: group.groupId, items: group.items })),
	);

	const parts = groups.length;
	const extractionTokenUsage = splitTokenUsage(extractionCall.tokenUsage, parts);
	const clusteringTokenUsage = splitTokenUsage(clusteringCall.tokenUsage, parts);
	const perGroupExtractionLatency = Math.ceil(extractionCall.latencyMs / parts);
	const perGroupClusteringLatency = Math.ceil(clusteringCall.latencyMs / parts);

	return groups.map((group) => {
		const extraction =
			extractionByGroup.get(group.groupId) ??
			parseExtractionResponse({ items: [] }, group.items);
		const clustering =
			clusteringByGroup.get(group.groupId) ??
			parseClusteringResponse({}, group.items);

		return {
			modelId: config.id,
			provider: config.provider,
			groupId: group.groupId,
			extraction,
			clustering,
			extractionLatencyMs: perGroupExtractionLatency,
			clusteringLatencyMs: perGroupClusteringLatency,
			totalLatencyMs: perGroupExtractionLatency + perGroupClusteringLatency,
			tokenEstimates: {
				extractionPrompt: splitEstimate(extractionCall.promptTokenEstimate, parts),
				extractionResponse: splitEstimate(
					extractionCall.responseTokenEstimate,
					parts,
				),
				clusteringPrompt: splitEstimate(clusteringCall.promptTokenEstimate, parts),
				clusteringResponse: splitEstimate(
					clusteringCall.responseTokenEstimate,
					parts,
				),
				total:
					splitEstimate(extractionCall.promptTokenEstimate, parts) +
					splitEstimate(extractionCall.responseTokenEstimate, parts) +
					splitEstimate(clusteringCall.promptTokenEstimate, parts) +
					splitEstimate(clusteringCall.responseTokenEstimate, parts),
			},
			tokenUsage: {
				extraction: extractionTokenUsage,
				clustering: clusteringTokenUsage,
				total: {
					promptTokens: addNullable(
						extractionTokenUsage.promptTokens,
						clusteringTokenUsage.promptTokens,
					),
					completionTokens: addNullable(
						extractionTokenUsage.completionTokens,
						clusteringTokenUsage.completionTokens,
					),
					totalTokens: addNullable(
						extractionTokenUsage.totalTokens,
						clusteringTokenUsage.totalTokens,
					),
					costUsd: addNullable(extractionTokenUsage.costUsd, clusteringTokenUsage.costUsd),
				},
			},
		};
	});
}
