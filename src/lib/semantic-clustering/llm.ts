import { createLogger } from "@/utils/logger";
import {
	parseEnsembleConfig,
	readApiKey,
	STRICT_CASCADE_THRESHOLDS,
	type EnsembleModelConfig,
} from "./config";
import type {
	CascadeResult,
	CascadeThresholds,
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

function clampConfidence(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	if (value > 1) {
		return Math.min(1, value / 100);
	}
	return Math.min(1, Math.max(0, value));
}

function buildPrompt(itemA: SemanticLLMItem, itemB: SemanticLLMItem): string {
	return `You are an expert grocery product matcher for Croatian retail catalogs.
Determine relationship between Item A and Item B.

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

Item A:
${JSON.stringify(itemA)}

Item B:
${JSON.stringify(itemB)}

Respond JSON only:
{"verdict":"EXACT_MATCH|SAME_BASE_DIFFERENT_VARIANT|MISMATCH|UNCERTAIN","confidence":0.0,"reasoning":"..."}`;
}

function tryParseJson(content: string): LLMJsonResponse {
	const jsonMatch = content.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("Response does not contain JSON object");
	}
	const parsed = JSON.parse(jsonMatch[0]) as Partial<LLMJsonResponse>;
	const verdict = parsed.verdict;
	if (!verdict || !ALLOWED_VERDICTS.includes(verdict)) {
		throw new Error(`Invalid verdict in response: ${String(verdict)}`);
	}
	return {
		verdict,
		confidence: clampConfidence(Number(parsed.confidence ?? 0)),
		reasoning: String(parsed.reasoning ?? "No reasoning provided"),
	};
}

async function callOpenAiCompatible(
	config: EnsembleModelConfig,
	itemA: SemanticLLMItem,
	itemB: SemanticLLMItem,
): Promise<LLMJsonResponse> {
	const apiKey = readApiKey(config);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	try {
		const response = await fetch(config.endpoint ?? "", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: config.model,
				temperature: 0,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: buildPrompt(itemA, itemB) },
					{ role: "user", content: "Return the JSON verdict now." },
				],
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(
				`${config.provider}:${config.model} HTTP ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = data.choices?.[0]?.message?.content;
		if (!content) {
			throw new Error("No content in model response");
		}
		return tryParseJson(content);
	} finally {
		clearTimeout(timeout);
	}
}

async function callClaude(
	config: EnsembleModelConfig,
	itemA: SemanticLLMItem,
	itemB: SemanticLLMItem,
): Promise<LLMJsonResponse> {
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
				max_tokens: 400,
				temperature: 0,
				system: buildPrompt(itemA, itemB),
				messages: [{ role: "user", content: "Return the JSON verdict now." }],
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
		return tryParseJson(textPart);
	} finally {
		clearTimeout(timeout);
	}
}

async function callModel(
	config: EnsembleModelConfig,
	itemA: SemanticLLMItem,
	itemB: SemanticLLMItem,
): Promise<SemanticVote> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
		const start = Date.now();
		try {
			const parsed =
				config.provider === "claude"
					? await callClaude(config, itemA, itemB)
					: await callOpenAiCompatible(config, itemA, itemB);
			return {
				modelId: config.id,
				provider: config.provider,
				verdict: parsed.verdict,
				confidence: clampConfidence(parsed.confidence),
				reasoning: parsed.reasoning,
				latencyMs: Date.now() - start,
			};
		} catch (error) {
			lastError = error;
			if (attempt < config.maxRetries) {
				await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
			}
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error(`Model call failed for ${config.id}`);
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
	const finalConfidence =
		supportWeight > 0 ? winnerScore / supportWeight : 0;
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

export async function evaluatePairWithCascade(input: {
	itemA: SemanticLLMItem;
	itemB: SemanticLLMItem;
	thresholds?: CascadeThresholds;
}): Promise<CascadeResult> {
	const thresholds = input.thresholds ?? STRICT_CASCADE_THRESHOLDS;
	let modelConfigs: EnsembleModelConfig[];
	try {
		const rawConfig = process.env.LLM_ENSEMBLE_JSON ?? "";
		if (rawConfig !== cachedRawConfig) {
			cachedConfig = parseEnsembleConfig(rawConfig);
			cachedRawConfig = rawConfig;
		}
		modelConfigs = cachedConfig;
	} catch (error) {
		return {
			votes: [],
			finalVerdict: "UNCERTAIN",
			finalConfidence: 0,
			consensusScore: 0,
			decisionState: "SYSTEM_ERROR",
			systemError: `Invalid ensemble configuration: ${String(error)}`,
		};
	}
	const weights = new Map(modelConfigs.map((config) => [config.id, config.weight]));
	const votes: SemanticVote[] = [];

	const model1 = modelConfigs[0];
	try {
		votes.push(await callModel(model1, input.itemA, input.itemB));
	} catch (error) {
		return {
			votes,
			finalVerdict: "UNCERTAIN",
			finalConfidence: 0,
			consensusScore: 0,
			decisionState: "SYSTEM_ERROR",
			systemError: `Primary model failed: ${String(error)}`,
		};
	}

	if (votes[0].confidence >= thresholds.escalateThreshold) {
		const finalized = weightedFinalize(votes, weights, thresholds);
		return {
			votes,
			...finalized,
			systemError: null,
		};
	}

	if (modelConfigs.length >= 2) {
		const model2 = modelConfigs[1];
		try {
			votes.push(await callModel(model2, input.itemA, input.itemB));
		} catch (error) {
			return {
				votes,
				finalVerdict: "UNCERTAIN",
				finalConfidence: 0,
				consensusScore: 0,
				decisionState: "SYSTEM_ERROR",
				systemError: `Verification model failed: ${String(error)}`,
			};
		}
	}

	if (
		modelConfigs.length >= 3 &&
		needsTieBreaker(votes, thresholds.autoApproveConfidence)
	) {
		const model3 = modelConfigs[2];
		try {
			votes.push(await callModel(model3, input.itemA, input.itemB));
		} catch (error) {
			return {
				votes,
				finalVerdict: "UNCERTAIN",
				finalConfidence: 0,
				consensusScore: 0,
				decisionState: "SYSTEM_ERROR",
				systemError: `Tie-breaker model failed: ${String(error)}`,
			};
		}
	}

	const finalized = weightedFinalize(votes, weights, thresholds);
	log.debug("Semantic cascade vote finalized", {
		votes: votes.map((vote) => ({
			model: vote.modelId,
			verdict: vote.verdict,
			confidence: vote.confidence,
		})),
		finalVerdict: finalized.finalVerdict,
		finalConfidence: finalized.finalConfidence,
		consensusScore: finalized.consensusScore,
		decisionState: finalized.decisionState,
	});

	return {
		votes,
		...finalized,
		systemError: null,
	};
}
