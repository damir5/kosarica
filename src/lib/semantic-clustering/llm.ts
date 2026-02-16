import { createLogger } from "@/utils/logger";
import { callVertexExpressGenerateContent } from "@/lib/llm/vertex-express";
import {
	type EnsembleModelConfig,
	parseEnsembleConfig,
	readApiKey,
	STRICT_CASCADE_THRESHOLDS,
} from "./config";
import type {
	CascadeResult,
	CascadeThresholds,
	SemanticBatchPairInput,
	SemanticLLMItem,
	SemanticVerdict,
	SemanticVote,
} from "./types";

const log = createLogger("matching");
let cachedRawConfig = "__unset__";
let cachedConfig: EnsembleModelConfig[] = [];

const ALLOWED_VERDICTS: SemanticVerdict[] = [
	"EXACT_MATCH",
	"SAME_BASE_DIFFERENT_VARIANT",
	"MISMATCH",
	"UNCERTAIN",
];

interface LLMJsonResponse {
	verdict: SemanticVerdict;
	confidence: number;
	reasoning: string;
}

interface LLMBatchJsonResponse extends LLMJsonResponse {
	pairId: string;
}

type OpenAiResponseFormat =
	| { type: "json_object" }
	| {
			type: "json_schema";
			json_schema: {
				name: string;
				schema: {
					type: "object";
					properties: {
						results: {
							type: "array";
							items: {
								type: "object";
								properties: {
									pair_id: { type: "string" };
									verdict: {
										type: "string";
										enum: SemanticVerdict[];
									};
									confidence: { type: "number" };
									reasoning: { type: "string" };
								};
								required: Array<
									"pair_id" | "verdict" | "confidence" | "reasoning"
								>;
							};
						};
					};
					required: ["results"];
				};
			};
	  }
	| { type: "text" }
	| { type: "none" };

type OpenAiResponseFormatType = OpenAiResponseFormat["type"];

const OPENAI_RESPONSE_FORMAT_ORDER: OpenAiResponseFormatType[] = [
	"json_object",
	"json_schema",
	"text",
];
const responseFormatPreferenceByEndpoint = new Map<
	string,
	OpenAiResponseFormatType
>();

function clampConfidence(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	if (value > 1) {
		return Math.min(1, value / 100);
	}
	return Math.min(1, Math.max(0, value));
}

function buildBatchPrompt(pairs: SemanticBatchPairInput[]): string {
	return `You are an expert grocery product matcher for Croatian retail catalogs.
You will receive a list of item pairs. For each pair, return one verdict.

Allowed verdicts:
- EXACT_MATCH: same exact sellable variant.
- SAME_BASE_DIFFERENT_VARIANT: same base product but size/pack/container variant.
- MISMATCH: different product.
- UNCERTAIN: not enough confidence.

Rules:
1) Brand mismatch usually means MISMATCH unless obvious same family spelling.
2) Flavor/variant mismatch means MISMATCH.
3) 330g and 0.33kg are equivalent quantities.
4) Multipack can be SAME_BASE_DIFFERENT_VARIANT vs single.
5) Container changes (can/bottle/glass) are SAME_BASE_DIFFERENT_VARIANT.
6) Be conservative. If not sure, return UNCERTAIN.

Return strict JSON only with this shape:
{
  "results": [
    {
      "pair_id": "string",
      "verdict": "EXACT_MATCH|SAME_BASE_DIFFERENT_VARIANT|MISMATCH|UNCERTAIN",
      "confidence": 0.0,
      "reasoning": "short explanation"
    }
  ]
}

Pairs:
${JSON.stringify(
	pairs.map((pair) => ({
		pair_id: pair.pairId,
		item_a: pair.itemA,
		item_b: pair.itemB,
	})),
)}`;
}

function stripModelWrappers(content: string): string {
	return content
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
		.replace(/```(?:json)?/gi, "")
		.replace(/```/g, "");
}

function extractJsonCandidates(content: string): string[] {
	const candidates: string[] = [];
	let depth = 0;
	let startIndex: number | null = null;
	let inString = false;
	let escapeNext = false;
	let opener: "{" | "[" | null = null;

	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];
		if (escapeNext) {
			escapeNext = false;
			continue;
		}
		if (char === "\\") {
			escapeNext = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) {
			continue;
		}
		if (char === "{" || char === "[") {
			if (depth === 0) {
				startIndex = index;
				opener = char;
			}
			depth += 1;
			continue;
		}
		if (char === "}" || char === "]") {
			if (depth > 0) {
				depth -= 1;
				if (depth === 0 && startIndex != null) {
					const segment = content.slice(startIndex, index + 1);
					if (segment.startsWith(opener ?? "")) {
						candidates.push(segment);
					}
					startIndex = null;
					opener = null;
				}
			}
		}
	}

	return candidates;
}

export function extractJsonPayload(content: string): unknown {
	const cleaned = stripModelWrappers(content).trim();
	if (cleaned.length === 0) {
		throw new Error("Model response is empty");
	}

	try {
		return JSON.parse(cleaned);
	} catch {
		// Continue to candidate scanning.
	}

	const candidates = extractJsonCandidates(cleaned);
	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate);
		} catch {
			// Continue scanning.
		}
	}

	const snippet = cleaned.slice(0, 320);
	throw new Error(`Response does not contain valid JSON. Snippet: ${snippet}`);
}

function parseVerdict(value: unknown): SemanticVerdict {
	const normalized = String(value ?? "")
		.trim()
		.toUpperCase();
	if (ALLOWED_VERDICTS.includes(normalized as SemanticVerdict)) {
		return normalized as SemanticVerdict;
	}
	throw new Error(`Invalid verdict in response: ${String(value)}`);
}

function parseReasoning(value: unknown): string {
	const reasoning = String(value ?? "").trim();
	return reasoning.length > 0 ? reasoning : "No reasoning provided";
}

function normalizeBatchEntries(
	payload: unknown,
	expectedPairIds: Set<string>,
): LLMBatchJsonResponse[] {
	const sourceEntries: unknown[] = (() => {
		if (Array.isArray(payload)) {
			return payload;
		}
		if (payload && typeof payload === "object") {
			const maybeObject = payload as {
				results?: unknown;
				pairs?: unknown;
				items?: unknown;
			};
			if (Array.isArray(maybeObject.results)) {
				return maybeObject.results;
			}
			if (Array.isArray(maybeObject.pairs)) {
				return maybeObject.pairs;
			}
			if (Array.isArray(maybeObject.items)) {
				return maybeObject.items;
			}
		}
		return [];
	})();

	const normalized: LLMBatchJsonResponse[] = [];

	for (const entry of sourceEntries) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const candidate = entry as {
			pair_id?: unknown;
			pairId?: unknown;
			id?: unknown;
			verdict?: unknown;
			confidence?: unknown;
			reasoning?: unknown;
		};
		const pairIdRaw = candidate.pair_id ?? candidate.pairId ?? candidate.id;
		const pairId = String(pairIdRaw ?? "").trim();
		if (pairId.length === 0 || !expectedPairIds.has(pairId)) {
			continue;
		}

		normalized.push({
			pairId,
			verdict: parseVerdict(candidate.verdict),
			confidence: clampConfidence(Number(candidate.confidence ?? 0)),
			reasoning: parseReasoning(candidate.reasoning),
		});
	}

	return normalized;
}

function parseBatchJson(
	content: string,
	expectedPairIds: Set<string>,
): Map<string, LLMJsonResponse> {
	const payload = extractJsonPayload(content);
	const entries = normalizeBatchEntries(payload, expectedPairIds);
	if (entries.length === 0) {
		throw new Error("No valid pair decisions in JSON response");
	}

	const decisions = new Map<string, LLMJsonResponse>();
	for (const entry of entries) {
		decisions.set(entry.pairId, {
			verdict: entry.verdict,
			confidence: entry.confidence,
			reasoning: entry.reasoning,
		});
	}
	return decisions;
}

function buildJsonSchemaResponseFormat(): OpenAiResponseFormat {
	return {
		type: "json_schema",
		json_schema: {
			name: "pair_results",
			schema: {
				type: "object",
				properties: {
					results: {
						type: "array",
						items: {
							type: "object",
							properties: {
								pair_id: { type: "string" },
								verdict: {
									type: "string",
									enum: ALLOWED_VERDICTS,
								},
								confidence: { type: "number" },
								reasoning: { type: "string" },
							},
							required: ["pair_id", "verdict", "confidence", "reasoning"],
						},
					},
				},
				required: ["results"],
			},
		},
	};
}

function responseFormatType(
	format: OpenAiResponseFormat,
): OpenAiResponseFormatType {
	return format.type;
}

function openAiEndpointPreferenceKey(config: EnsembleModelConfig): string {
	return `${config.provider}|${config.model}|${config.endpoint ?? ""}`;
}

function buildResponseFormat(
	formatType: OpenAiResponseFormatType,
): OpenAiResponseFormat {
	if (formatType === "json_schema") {
		return buildJsonSchemaResponseFormat();
	}
	return { type: formatType };
}

function orderedResponseFormats(
	preferred: OpenAiResponseFormatType | undefined,
): OpenAiResponseFormat[] {
	if (preferred === "none") {
		return [{ type: "none" }];
	}
	if (!preferred) {
		return OPENAI_RESPONSE_FORMAT_ORDER.map((formatType) =>
			buildResponseFormat(formatType),
		);
	}

	const order = [
		preferred,
		...OPENAI_RESPONSE_FORMAT_ORDER.filter(
			(formatType) => formatType !== preferred,
		),
	];
	return order.map((formatType) => buildResponseFormat(formatType));
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

async function callOpenAiCompatibleBatch(
	config: EnsembleModelConfig,
	pairs: SemanticBatchPairInput[],
): Promise<Map<string, LLMJsonResponse>> {
	const apiKey = readApiKey(config);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	const preferenceKey = openAiEndpointPreferenceKey(config);

	try {
		const expectedPairIds = new Set(pairs.map((pair) => pair.pairId));
		const preferredFormat =
			config.responseFormat ??
			responseFormatPreferenceByEndpoint.get(preferenceKey);
		const responseFormatAttempts = orderedResponseFormats(preferredFormat);

		let lastError: Error | null = null;
		for (const [
			attemptIndex,
			responseFormat,
		] of responseFormatAttempts.entries()) {
			const formatForRequest =
				responseFormat.type === "none" ? undefined : responseFormat;
			const response = await fetch(config.endpoint ?? "", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: config.model,
					temperature: 0,
					...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
					...(formatForRequest ? { response_format: formatForRequest } : {}),
					messages: [
						{ role: "system", content: "Return strict JSON only." },
						{ role: "user", content: buildBatchPrompt(pairs) },
					],
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				const isLastAttempt =
					attemptIndex === responseFormatAttempts.length - 1;
				if (
					!isLastAttempt &&
					isLikelyResponseFormatError(response.status, errorBody)
				) {
					log.warn(
						"OpenAI-compatible endpoint rejected response_format, trying fallback",
						{
							model: config.model,
							endpoint: config.endpoint,
							attemptFormat: responseFormat.type,
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

			const data = (await response.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			const content = data.choices?.[0]?.message?.content;
			if (!content) {
				lastError = new Error("No content in model response");
				break;
			}

			const activeFormat = responseFormatType(responseFormat);
			if (
				responseFormatPreferenceByEndpoint.get(preferenceKey) !== activeFormat
			) {
				responseFormatPreferenceByEndpoint.set(preferenceKey, activeFormat);
				log.info("OpenAI-compatible response_format preference updated", {
					model: config.model,
					endpoint: config.endpoint,
					preferredResponseFormat: activeFormat,
				});
			}

			return parseBatchJson(content, expectedPairIds);
		}

		throw lastError ?? new Error("OpenAI-compatible batch request failed");
	} finally {
		clearTimeout(timeout);
	}
}

async function callClaudeBatch(
	config: EnsembleModelConfig,
	pairs: SemanticBatchPairInput[],
): Promise<Map<string, LLMJsonResponse>> {
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
				max_tokens: 1200,
				temperature: 0,
				system: "Return strict JSON only.",
				messages: [{ role: "user", content: buildBatchPrompt(pairs) }],
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(
				`${config.provider}:${config.model} HTTP ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>;
		};
		const textPart = data.content?.find((part) => part.type === "text")?.text;
		if (!textPart) {
			throw new Error("No text content in Claude response");
		}
		return parseBatchJson(textPart, new Set(pairs.map((pair) => pair.pairId)));
	} finally {
		clearTimeout(timeout);
	}
}

function buildVertexBatchResponseSchema(): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			results: {
				type: "array",
				items: {
					type: "object",
					properties: {
						pair_id: { type: "string" },
						verdict: { type: "string", enum: ALLOWED_VERDICTS },
						confidence: { type: "number" },
						reasoning: { type: "string" },
					},
					required: ["pair_id", "verdict", "confidence", "reasoning"],
				},
			},
		},
		required: ["results"],
	};
}

async function callVertexExpressBatch(
	config: EnsembleModelConfig,
	pairs: SemanticBatchPairInput[],
): Promise<Map<string, LLMJsonResponse>> {
	const expectedPairIds = new Set(pairs.map((pair) => pair.pairId));
	const { responseText } = await callVertexExpressGenerateContent({
		config,
		systemMsg: "Return strict JSON only.",
		userMsg: buildBatchPrompt(pairs),
		responseMimeType: "application/json",
		responseSchema: buildVertexBatchResponseSchema(),
	});

	return parseBatchJson(responseText, expectedPairIds);
}

async function callModelBatch(
	config: EnsembleModelConfig,
	pairs: SemanticBatchPairInput[],
): Promise<Map<string, SemanticVote>> {
	if (pairs.length === 0) {
		return new Map();
	}

	let lastError: unknown;
	for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
		const start = Date.now();
		try {
			const parsedMap =
				config.provider === "claude"
					? await callClaudeBatch(config, pairs)
					: config.provider === "vertex-express"
						? await callVertexExpressBatch(config, pairs)
					: await callOpenAiCompatibleBatch(config, pairs);

			const latencyMs = Date.now() - start;
			const votes = new Map<string, SemanticVote>();
			for (const pair of pairs) {
				const parsed = parsedMap.get(pair.pairId);
				if (!parsed) {
					votes.set(pair.pairId, {
						modelId: config.id,
						provider: config.provider,
						verdict: "UNCERTAIN",
						confidence: 0,
						reasoning: "Pair was missing from batch response",
						latencyMs,
					});
					continue;
				}

				votes.set(pair.pairId, {
					modelId: config.id,
					provider: config.provider,
					verdict: parsed.verdict,
					confidence: clampConfidence(parsed.confidence),
					reasoning: parsed.reasoning,
					latencyMs,
				});
			}

			return votes;
		} catch (error) {
			lastError = error;
			if (attempt < config.maxRetries) {
				await new Promise((resolve) =>
					setTimeout(resolve, 250 * (attempt + 1)),
				);
			}
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`Model call failed for ${config.id}`);
}

function systemErrorResult(
	message: string,
	votes: SemanticVote[] = [],
): CascadeResult {
	return {
		votes,
		finalVerdict: "UNCERTAIN",
		finalConfidence: 0,
		consensusScore: 0,
		decisionState: "SYSTEM_ERROR",
		systemError: message,
	};
}

function loadModelConfigs(): EnsembleModelConfig[] {
	const rawConfig = process.env.LLM_ENSEMBLE_JSON ?? "";
	if (rawConfig !== cachedRawConfig) {
		cachedConfig = parseEnsembleConfig(rawConfig);
		cachedRawConfig = rawConfig;
	}
	return cachedConfig;
}

function weightedFinalize(
	votes: SemanticVote[],
	weights: Map<string, number>,
	thresholds: CascadeThresholds,
): Omit<CascadeResult, "votes" | "systemError"> {
	const byVerdict = new Map<SemanticVerdict, number>();
	let totalWeight = 0;

	for (const vote of votes) {
		const weight = weights.get(vote.modelId) ?? 1;
		totalWeight += weight;
		const score = weight * vote.confidence;
		byVerdict.set(vote.verdict, (byVerdict.get(vote.verdict) ?? 0) + score);
	}

	let finalVerdict: SemanticVerdict = "UNCERTAIN";
	let winnerScore = -1;
	for (const verdict of ALLOWED_VERDICTS) {
		const score = byVerdict.get(verdict) ?? 0;
		if (score > winnerScore) {
			winnerScore = score;
			finalVerdict = verdict;
		}
	}

	const supportVotes = votes.filter((vote) => vote.verdict === finalVerdict);
	const supportWeight = supportVotes.reduce(
		(sum, vote) => sum + (weights.get(vote.modelId) ?? 1),
		0,
	);
	const finalConfidence = supportWeight > 0 ? winnerScore / supportWeight : 0;
	const consensusScore = totalWeight > 0 ? supportWeight / totalWeight : 0;

	let decisionState: CascadeResult["decisionState"] = "PENDING_REVIEW";
	const isMatchVerdict =
		finalVerdict === "EXACT_MATCH" ||
		finalVerdict === "SAME_BASE_DIFFERENT_VARIANT";

	if (
		isMatchVerdict &&
		finalConfidence >= thresholds.autoApproveConfidence &&
		consensusScore >= thresholds.minConsensusForAutomation
	) {
		decisionState = "AUTO_APPROVED";
	} else if (
		finalVerdict === "MISMATCH" &&
		finalConfidence >= thresholds.autoRejectConfidence &&
		consensusScore >= thresholds.minConsensusForAutomation
	) {
		decisionState = "AUTO_REJECTED";
	} else {
		decisionState = "PENDING_REVIEW";
	}

	return {
		finalVerdict,
		finalConfidence,
		consensusScore,
		decisionState,
	};
}

function needsTieBreaker(
	votes: SemanticVote[],
	autoApproveThreshold: number,
): boolean {
	if (votes.length < 2) {
		return false;
	}
	const [first, second] = votes;
	if (first.verdict !== second.verdict) {
		return true;
	}
	return (
		first.confidence < autoApproveThreshold ||
		second.confidence < autoApproveThreshold
	);
}

export async function evaluatePairsWithCascadeBatch(input: {
	pairs: SemanticBatchPairInput[];
	thresholds?: CascadeThresholds;
}): Promise<Map<string, CascadeResult>> {
	const results = new Map<string, CascadeResult>();
	if (input.pairs.length === 0) {
		return results;
	}

	const thresholds = input.thresholds ?? STRICT_CASCADE_THRESHOLDS;
	let modelConfigs: EnsembleModelConfig[];
	try {
		modelConfigs = loadModelConfigs();
	} catch (error) {
		const message = `Invalid ensemble configuration: ${String(error)}`;
		for (const pair of input.pairs) {
			results.set(pair.pairId, systemErrorResult(message));
		}
		return results;
	}

	const weights = new Map(
		modelConfigs.map((config) => [config.id, config.weight]),
	);
	const votesByPair = new Map<string, SemanticVote[]>();
	for (const pair of input.pairs) {
		votesByPair.set(pair.pairId, []);
	}

	const model1 = modelConfigs[0];
	try {
		const firstVotes = await callModelBatch(model1, input.pairs);
		for (const pair of input.pairs) {
			const vote = firstVotes.get(pair.pairId);
			if (vote) {
				votesByPair.get(pair.pairId)?.push(vote);
			}
		}
	} catch (error) {
		const message = `Primary model failed: ${String(error)}`;
		for (const pair of input.pairs) {
			results.set(pair.pairId, systemErrorResult(message));
		}
		return results;
	}

	let unresolvedPairs = input.pairs.filter((pair) => {
		const votes = votesByPair.get(pair.pairId) ?? [];
		return (
			votes.length > 0 && votes[0].confidence < thresholds.escalateThreshold
		);
	});

	if (modelConfigs.length >= 2 && unresolvedPairs.length > 0) {
		const model2 = modelConfigs[1];
		try {
			const secondVotes = await callModelBatch(model2, unresolvedPairs);
			for (const pair of unresolvedPairs) {
				const vote = secondVotes.get(pair.pairId);
				if (vote) {
					votesByPair.get(pair.pairId)?.push(vote);
				}
			}
		} catch (error) {
			const message = `Verification model failed: ${String(error)}`;
			for (const pair of unresolvedPairs) {
				results.set(
					pair.pairId,
					systemErrorResult(message, votesByPair.get(pair.pairId) ?? []),
				);
			}
			unresolvedPairs = [];
		}
	}

	if (modelConfigs.length >= 3 && unresolvedPairs.length > 0) {
		const tieBreakerPairs = unresolvedPairs.filter((pair) =>
			needsTieBreaker(
				votesByPair.get(pair.pairId) ?? [],
				thresholds.autoApproveConfidence,
			),
		);

		if (tieBreakerPairs.length > 0) {
			const model3 = modelConfigs[2];
			try {
				const thirdVotes = await callModelBatch(model3, tieBreakerPairs);
				for (const pair of tieBreakerPairs) {
					const vote = thirdVotes.get(pair.pairId);
					if (vote) {
						votesByPair.get(pair.pairId)?.push(vote);
					}
				}
			} catch (error) {
				const message = `Tie-breaker model failed: ${String(error)}`;
				for (const pair of tieBreakerPairs) {
					results.set(
						pair.pairId,
						systemErrorResult(message, votesByPair.get(pair.pairId) ?? []),
					);
				}
			}
		}
	}

	for (const pair of input.pairs) {
		if (results.has(pair.pairId)) {
			continue;
		}

		const votes = votesByPair.get(pair.pairId) ?? [];
		if (votes.length === 0) {
			results.set(
				pair.pairId,
				systemErrorResult("No model votes received for pair"),
			);
			continue;
		}

		const finalized = weightedFinalize(votes, weights, thresholds);
		results.set(pair.pairId, {
			votes,
			...finalized,
			systemError: null,
		});
	}

	log.debug("Semantic cascade batch finalized", {
		pairs: input.pairs.length,
		approved: Array.from(results.values()).filter(
			(result) => result.decisionState === "AUTO_APPROVED",
		).length,
		rejected: Array.from(results.values()).filter(
			(result) => result.decisionState === "AUTO_REJECTED",
		).length,
		systemErrors: Array.from(results.values()).filter(
			(result) => result.decisionState === "SYSTEM_ERROR",
		).length,
	});

	return results;
}

export async function evaluatePairWithCascade(input: {
	itemA: SemanticLLMItem;
	itemB: SemanticLLMItem;
	thresholds?: CascadeThresholds;
}): Promise<CascadeResult> {
	const pairId = "single_pair";
	const results = await evaluatePairsWithCascadeBatch({
		pairs: [{ pairId, itemA: input.itemA, itemB: input.itemB }],
		thresholds: input.thresholds,
	});
	return (
		results.get(pairId) ??
		systemErrorResult("Batch evaluation did not return a decision")
	);
}
