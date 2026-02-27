/* eslint-disable no-console */
import { and, isNull, sql } from "drizzle-orm";
import { retailerItems } from "@/db";
import { parseRetailerItemFeature } from "@/lib/semantic-clustering/normalize";
import {
	parseEnsembleConfig,
	readApiKey,
	type EnsembleModelConfig,
} from "@/lib/semantic-clustering/config";
import { extractJsonPayload as extractJsonFromContent } from "@/lib/semantic-clustering/llm";
import {
	parseCategorizationResponse,
	type ParsedCategorization,
} from "@/lib/categorization/parse";
import { getDb } from "@/utils/bindings";

type ProviderKey = "openrouter" | "local";

type ModelTarget = {
	key: ProviderKey;
	label: string;
	config: EnsembleModelConfig;
	maxTokens: number;
	timeoutMs: number;
	rpmLimit: number | null;
	useResponseFormat: boolean;
};

type ItemRow = {
	id: string;
	name: string;
	brand: string | null;
	category: string | null;
	subcategory: string | null;
	unit: string | null;
	unitQuantity: string | null;
	chainSlug: string | null;
};

type Baseline = {
	extractedBrand: string | null;
	extractedAmount: number | null;
	extractedUnit: string | null;
	packAmount: number | null;
	containerType: string | null;
};

type BatchRun = {
	callIndex: number;
	itemCount: number;
	latencyMs: number;
	httpStatus: number | null;
	parseOk: boolean;
	schemaRecovered: boolean;
	error: string | null;
	errorStage: "http" | "extract_json" | "schema" | "unknown" | null;
	responseSnippet: string | null;
};

type ItemEval = {
	hasResult: boolean;
	productTypeNonNull: boolean;
	everydayNameNonNull: boolean;
	brandNonNull: boolean;
	amountNonNull: boolean;
	unitNonNull: boolean;
	packNonNull: boolean;
	containerNonNull: boolean;
	brandMatch: boolean | null;
	amountUnitMatch: boolean | null;
	packMatch: boolean | null;
	containerMatch: boolean | null;
	confidence: number | null;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): { n: number; batch: number } {
	let n = parsePositiveInt(process.env.EVAL_N, 300);
	let batch = parsePositiveInt(process.env.EVAL_BATCH, 30);

	for (const arg of argv) {
		if (arg.startsWith("--n=")) n = parsePositiveInt(arg.split("=", 2)[1], n);
		if (arg.startsWith("--batch="))
			batch = parsePositiveInt(arg.split("=", 2)[1], batch);
	}

	return {
		n: Math.min(1000, Math.max(10, n)),
		batch: Math.min(60, Math.max(5, batch)),
	};
}

function normText(value: string | null): string {
	if (!value) return "";
	return value
		.toLowerCase()
		.replace(/[^a-z0-9čćđšž]+/gi, "")
		.trim();
}

function brandMatches(pred: string | null, truth: string | null): boolean | null {
	if (!truth) return null;
	if (!pred) return false;
	const p = normText(pred);
	const t = normText(truth);
	if (p.length === 0 || t.length === 0) return false;
	return p === t || p.includes(t) || t.includes(p);
}

function toBaseAmount(amount: number | null, unit: string | null): {
	kind: "mass" | "volume" | "count" | "unknown";
	value: number | null;
} {
	if (amount == null || !Number.isFinite(amount) || amount <= 0) {
		return { kind: "unknown", value: null };
	}
	switch (unit) {
		case "g":
			return { kind: "mass", value: amount };
		case "kg":
			return { kind: "mass", value: amount * 1000 };
		case "ml":
			return { kind: "volume", value: amount };
		case "l":
			return { kind: "volume", value: amount * 1000 };
		case "kom":
			return { kind: "count", value: amount };
		default:
			return { kind: "unknown", value: null };
	}
}

function amountUnitMatches(
	predAmount: number | null,
	predUnit: string | null,
	truthAmount: number | null,
	truthUnit: string | null,
): boolean | null {
	if (truthAmount == null || !truthUnit) return null;
	if (predAmount == null || !predUnit) return false;
	const p = toBaseAmount(predAmount, predUnit);
	const t = toBaseAmount(truthAmount, truthUnit);
	if (p.kind === "unknown" || t.kind === "unknown") return false;
	if (p.kind !== t.kind) return false;
	if (p.value == null || t.value == null) return false;
	const diff = Math.abs(p.value - t.value);
	const denom = Math.max(1, Math.abs(t.value));
	return diff / denom <= 0.05; // 5% tolerance
}

function eqNullable<T>(a: T | null, b: T | null): boolean | null {
	if (b == null) return null;
	return a === b;
}

function buildEvalMessages(
	rows: readonly ItemRow[],
	llmIdByRealId: ReadonlyMap<string, string>,
): {
	systemMessage: string;
	userMessage: string;
} {
	const systemMessage = [
		"You are a Croatian grocery product categorization expert.",
		"Return strict JSON only. No markdown. No extra text.",
		"Your response is parsed by a strict JSON parser; any extra text breaks the request.",
	].join("\n");

	const userMessage = [
		"Categorize all items below.",
		"Rules:",
		"- Be concise and consistent.",
		"- Use Croatian for product_type and everyday_name.",
		"- If unknown, set field to null.",
		"- You MUST output exactly one result per input item.",
		"- You MUST copy item_id EXACTLY from input (do not alter/renumber/invent).",
		"- Do not drop items. If uncertain, keep item_id and set other fields to null with low confidence.",
		"- Do not repeat the schema in your response.",
		"- Use the exact output keys shown below.",
		"- Always set \"search_tags\" to an empty array: [].",
		"",
		"Input items (JSON array):",
		JSON.stringify(
			rows.map((row) => ({
				// Short IDs are intentional: models often fail to copy long DB IDs verbatim.
				item_id: llmIdByRealId.get(row.id) ?? row.id,
				name: row.name,
				brand: row.brand,
				category: row.category,
				subcategory: row.subcategory,
				unit: row.unit,
				unit_quantity: row.unitQuantity,
				chain_slug: row.chainSlug,
			})),
			null,
			2,
		),
		"",
		"Output: return ONLY JSON object with this shape:",
		"{",
		"  \"results\": [",
		"    {",
		"      \"item_id\": \"string\",",
		"      \"confidence\": 0.95,",
		"      \"product_type\": \"string | null\",",
		"      \"brand\": \"string | null\",",
		"      \"everyday_name\": \"string | null\",",
		"      \"variant\": \"string | null\",",
		"      \"unit\": \"g|kg|ml|l|kom|null\",",
		"      \"amount\": \"string | null\",",
		"      \"package_size\": \"string | null\",",
		"      \"container\": \"PET|limenka|staklo|tetrapak|tuba|null\",",
		"      \"search_tags\": []",
		"    }",
		"  ]",
		"}",
	].join("\n");

	return { systemMessage, userMessage };
}

function coerceCategorizationPayload(payload: unknown): unknown {
	if (Array.isArray(payload)) {
		return { results: payload };
	}
	if (!payload || typeof payload !== "object") {
		return payload;
	}

	const obj = payload as Record<string, unknown>;

	// Common wrappers from various LLMs.
	if (Array.isArray(obj.results)) {
		return payload;
	}
	if (obj.data && typeof obj.data === "object") {
		const data = obj.data as Record<string, unknown>;
		if (Array.isArray(data.results)) {
			return { results: data.results };
		}
	}
	if (Array.isArray(obj.items)) {
		return { results: obj.items };
	}
	if (Array.isArray(obj.output)) {
		return { results: obj.output };
	}

	return payload;
}

function parseCategorizationFlexible(input: {
	payload: unknown;
	expectedItemIds: Set<string>;
}): { parsed: Map<string, ParsedCategorization>; schemaRecovered: boolean } {
	const coerced = coerceCategorizationPayload(input.payload);
	const schemaRecovered = coerced !== input.payload;
	const parsed = parseCategorizationResponse(coerced, input.expectedItemIds);
	return { parsed, schemaRecovered };
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (part && typeof part === "object") {
					const text = (part as { text?: unknown }).text;
					return typeof text === "string" ? text : "";
				}
				return "";
			})
			.join("");
	}
	return "";
}

function isLikelyResponseFormatError(status: number, bodyText: string): boolean {
	if (status !== 400 && status !== 422) return false;
	return /response[_\s-]?format|json_schema|json_object|unsupported/i.test(bodyText);
}

async function callOpenAiCompatible(input: {
	target: ModelTarget;
	messages: { systemMessage: string; userMessage: string };
}): Promise<{
	httpStatus: number;
	latencyMs: number;
	contentText: string;
}> {
	const apiKey = readApiKey(input.target.config);

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};
	if (input.target.config.provider === "openrouter") {
		headers["HTTP-Referer"] = "https://kosarica.local";
		headers["X-Title"] = "Kosarica LLM Quality Eval";
	}

	const baseBody = {
		model: input.target.config.model,
		temperature: 0,
		max_tokens: input.target.maxTokens,
		messages: [
			{ role: "system", content: input.messages.systemMessage },
			{ role: "user", content: input.messages.userMessage },
		],
	};

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), input.target.timeoutMs);
	const startedAt = Date.now();

	const doReq = async (withResponseFormat: boolean) => {
		const response = await fetch(input.target.config.endpoint ?? "", {
			method: "POST",
			headers,
			body: JSON.stringify(
				withResponseFormat
					? { ...baseBody, response_format: { type: "json_object" } }
					: baseBody,
			),
			signal: controller.signal,
		});
		const bodyText = await response.text();
		return { response, bodyText };
	};

	try {
		let attempt = await doReq(input.target.useResponseFormat);
		if (input.target.useResponseFormat) {
			if (
				!attempt.response.ok &&
				isLikelyResponseFormatError(attempt.response.status, attempt.bodyText)
			) {
				attempt = await doReq(false);
			}
		}

		const latencyMs = Date.now() - startedAt;
		const httpStatus = attempt.response.status;

		if (!attempt.response.ok) {
			throw new Error(
				`HTTP ${httpStatus} ${attempt.response.statusText} body=${attempt.bodyText.slice(0, 240)}`,
			);
		}

		const payload = JSON.parse(attempt.bodyText) as unknown;
		const message = (
			payload as {
				choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }>;
			}
		).choices?.[0]?.message;
		const content = message?.content;
		const reasoning = message?.reasoning;
		const contentText = contentToText(content);
		const reasoningText = typeof reasoning === "string" ? reasoning.trim() : "";

		return {
			httpStatus,
			latencyMs,
			// Some OpenRouter models put output into `reasoning` and leave `content` empty.
			contentText: contentText.trim().length > 0 ? contentText : reasoningText,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1]! + sorted[mid]!) / 2
		: sorted[mid]!;
}

function pct(numer: number, denom: number): number {
	return denom > 0 ? (numer / denom) * 100 : 0;
}

async function main(): Promise<void> {
	const { n, batch } = parseArgs(process.argv.slice(2));
	const db = getDb();

	const rows = (await db
		.select({
			id: retailerItems.id,
			name: retailerItems.name,
			brand: retailerItems.brand,
			category: retailerItems.category,
			subcategory: retailerItems.subcategory,
			unit: retailerItems.unit,
			unitQuantity: retailerItems.unitQuantity,
			chainSlug: retailerItems.chainSlug,
		})
		.from(retailerItems)
		.where(and(isNull(retailerItems.mergedIntoId)))
		.orderBy(sql`random()`)
		.limit(n)) as ItemRow[];

	const llmIdByRealId = new Map<string, string>();
	for (const [index, row] of rows.entries()) {
		// Keep IDs short and stable within this run.
		llmIdByRealId.set(row.id, String(index + 1));
	}

	const baselines = new Map<string, Baseline>();
	for (const row of rows) {
		const features = parseRetailerItemFeature({
			retailerItemId: row.id,
			name: row.name,
			brand: row.brand,
			category: row.category,
			unit: row.unit,
			unitQuantity: row.unitQuantity,
		});
		baselines.set(row.id, {
			extractedBrand: features.extractedBrand,
			extractedAmount: features.extractedAmount,
			extractedUnit: features.extractedUnit,
			packAmount: features.packAmount > 0 ? features.packAmount : null,
			containerType: features.containerType,
		});
	}

	const localConfig = (() => {
		const ensemble = parseEnsembleConfig(process.env.LLM_ENSEMBLE_JSON);
		const entry =
			ensemble.find((m) => m.model.includes("qwen/qwen3-4b")) ?? ensemble[0];
		if (!entry) throw new Error("No local model config found in LLM_ENSEMBLE_JSON");
		return { ...entry, provider: "openai" as const };
	})();

	const targets: ModelTarget[] = [
		{
			key: "openrouter",
			label: "openrouter:nvidia/nemotron-3-nano-30b-a3b:free",
			config: {
				id: "nemotron",
				provider: "openrouter",
				model: "nvidia/nemotron-3-nano-30b-a3b:free",
				endpoint: "https://openrouter.ai/api/v1/chat/completions",
				apiKeyEnv: "OPENROUTER_API_KEY",
				weight: 1,
				timeoutMs: 120_000,
				maxRetries: 0,
			},
			maxTokens: 2500,
			timeoutMs: 120_000,
			rpmLimit: 8,
			useResponseFormat: false,
		},
		{
			key: "openrouter",
			label: "openrouter:stepfun/step-3.5-flash:free",
			config: {
				id: "step",
				provider: "openrouter",
				model: "stepfun/step-3.5-flash:free",
				endpoint: "https://openrouter.ai/api/v1/chat/completions",
				apiKeyEnv: "OPENROUTER_API_KEY",
				weight: 1,
				timeoutMs: 120_000,
				maxRetries: 0,
			},
			maxTokens: 2500,
			timeoutMs: 120_000,
			rpmLimit: 8,
			useResponseFormat: false,
		},
		{
			key: "local",
			label: `local:${localConfig.model}`,
			config: {
				...localConfig,
				id: "local-qwen3-4b",
				provider: "openai",
				apiKeyEnv: localConfig.apiKeyEnv ?? "LOCAL_LLM_API_KEY",
			},
			maxTokens: 2500,
			timeoutMs: 240_000,
			rpmLimit: null,
			useResponseFormat: false,
		},
	];

	const batches: ItemRow[][] = [];
	for (let index = 0; index < rows.length; index += batch) {
		batches.push(rows.slice(index, index + batch));
	}

	const startedAtIso = new Date().toISOString();
	console.log(
		JSON.stringify({
			startedAt: startedAtIso,
			n: rows.length,
			batch,
			batches: batches.length,
			targets: targets.map((t) => t.label),
		}),
	);

	for (const target of targets) {
		const evalById = new Map<string, ItemEval>();
		const calls: BatchRun[] = [];

		const openrouterGapMs =
			target.rpmLimit && target.rpmLimit > 0
				? Math.ceil(60_000 / target.rpmLimit)
				: 0;
		let lastOpenrouterCallStart = 0;

		// Warm up local once (model load).
		if (target.key === "local") {
			try {
				const warmupBatch = batches[0] ?? [];
				if (warmupBatch.length > 0) {
					const messages = buildEvalMessages(warmupBatch.slice(0, 3), llmIdByRealId);
					await callOpenAiCompatible({ target, messages });
				}
			} catch {
				// ignore warmup failures; measured runs still proceed.
			}
		}

		for (const [callIndex, batchRows] of batches.entries()) {
			if (target.key === "openrouter" && openrouterGapMs > 0) {
				const now = Date.now();
				const waitMs = lastOpenrouterCallStart + openrouterGapMs - now;
				if (waitMs > 0) {
					await sleep(waitMs);
				}
				lastOpenrouterCallStart = Date.now();
			}

			const expectedLlmIds = new Set(
				batchRows
					.map((row) => llmIdByRealId.get(row.id))
					.filter((value): value is string => typeof value === "string"),
			);
			const messages = buildEvalMessages(batchRows, llmIdByRealId);
			const startedAt = Date.now();

			try {
				const response = await callOpenAiCompatible({ target, messages });
				const payload = extractJsonFromContent(response.contentText);
				const { parsed, schemaRecovered } = parseCategorizationFlexible({
					payload,
					expectedItemIds: expectedLlmIds,
				});

				const baselineFor = (id: string) => baselines.get(id) ?? null;
				for (const row of batchRows) {
					const llmId = llmIdByRealId.get(row.id) ?? row.id;
					const baseline = baselineFor(row.id);
					const result = parsed.get(llmId) ?? null;
					if (!result) {
						evalById.set(row.id, {
							hasResult: false,
							productTypeNonNull: false,
							everydayNameNonNull: false,
							brandNonNull: false,
							amountNonNull: false,
							unitNonNull: false,
							packNonNull: false,
							containerNonNull: false,
							brandMatch: baseline ? brandMatches(null, baseline.extractedBrand ?? row.brand) : null,
							amountUnitMatch: baseline ? amountUnitMatches(null, null, baseline.extractedAmount, baseline.extractedUnit) : null,
							packMatch: baseline ? eqNullable(null, baseline.packAmount) : null,
							containerMatch: baseline ? eqNullable(null, baseline.containerType) : null,
							confidence: null,
						});
						continue;
					}

					const truthBrand = baseline?.extractedBrand ?? row.brand;
					evalById.set(row.id, {
						hasResult: true,
						productTypeNonNull: result.productType != null,
						everydayNameNonNull: result.everydayName != null,
						brandNonNull: result.brand != null,
						amountNonNull: result.extractedAmount != null,
						unitNonNull: result.extractedUnit != null,
						packNonNull: result.packAmount != null,
						containerNonNull: result.containerType != null,
						brandMatch: brandMatches(result.brand, truthBrand),
						amountUnitMatch: baseline
							? amountUnitMatches(
									result.extractedAmount,
									result.extractedUnit,
									baseline.extractedAmount,
									baseline.extractedUnit,
								)
							: null,
						packMatch: baseline ? eqNullable(result.packAmount, baseline.packAmount) : null,
						containerMatch: baseline
							? eqNullable(result.containerType, baseline.containerType)
							: null,
						confidence: Number.isFinite(result.confidence) ? result.confidence : null,
					});
				}

				calls.push({
					callIndex: callIndex + 1,
					itemCount: batchRows.length,
					latencyMs: response.latencyMs,
					httpStatus: response.httpStatus,
					parseOk: true,
					schemaRecovered,
					error: null,
					errorStage: null,
					responseSnippet: null,
				});
			} catch (error) {
				const elapsedMs = Date.now() - startedAt;
				const message = error instanceof Error ? error.message : String(error);
				const errorStage: BatchRun["errorStage"] = (() => {
					if (typeof message !== "string") return "unknown";
					if (message.startsWith("HTTP ")) return "http";
					if (message.includes("Model response is empty")) return "extract_json";
					if (message.includes("valid JSON")) return "extract_json";
					if (message.includes("expected schema")) return "schema";
					return "unknown";
				})();
				calls.push({
					callIndex: callIndex + 1,
					itemCount: batchRows.length,
					latencyMs: elapsedMs,
					httpStatus: null,
					parseOk: false,
					schemaRecovered: false,
					error: message.slice(0, 220),
					errorStage,
					responseSnippet: null,
				});

				for (const row of batchRows) {
					if (!evalById.has(row.id)) {
						evalById.set(row.id, {
							hasResult: false,
							productTypeNonNull: false,
							everydayNameNonNull: false,
							brandNonNull: false,
							amountNonNull: false,
							unitNonNull: false,
							packNonNull: false,
							containerNonNull: false,
							brandMatch: null,
							amountUnitMatch: null,
							packMatch: null,
							containerMatch: null,
							confidence: null,
						});
					}
				}
			}
		}

		const all = Array.from(evalById.values());
		const found = all.filter((v) => v.hasResult).length;
		const productTypeNonNull = all.filter((v) => v.hasResult && v.productTypeNonNull).length;
		const everydayNameNonNull = all.filter((v) => v.hasResult && v.everydayNameNonNull).length;
		const brandNonNull = all.filter((v) => v.hasResult && v.brandNonNull).length;
		const amountNonNull = all.filter((v) => v.hasResult && v.amountNonNull).length;
		const unitNonNull = all.filter((v) => v.hasResult && v.unitNonNull).length;
		const packNonNull = all.filter((v) => v.hasResult && v.packNonNull).length;
		const containerNonNull = all.filter((v) => v.hasResult && v.containerNonNull).length;

		const brandTruthPresent = all.filter((v) => v.brandMatch !== null).length;
		const brandMatchCount = all.filter((v) => v.brandMatch === true).length;
		const amountTruthPresent = all.filter((v) => v.amountUnitMatch !== null).length;
		const amountMatchCount = all.filter((v) => v.amountUnitMatch === true).length;
		const packTruthPresent = all.filter((v) => v.packMatch !== null).length;
		const packMatchCount = all.filter((v) => v.packMatch === true).length;
		const containerTruthPresent = all.filter((v) => v.containerMatch !== null).length;
		const containerMatchCount = all.filter((v) => v.containerMatch === true).length;

		const okCalls = calls.filter((c) => c.parseOk).length;
		const recoveredCalls = calls.filter((c) => c.parseOk && c.schemaRecovered).length;
		const latenciesOk = calls.filter((c) => c.parseOk).map((c) => c.latencyMs);
		const avgLatencyMs =
			latenciesOk.length > 0
				? latenciesOk.reduce((sum, v) => sum + v, 0) / latenciesOk.length
				: null;

		console.log(
			JSON.stringify({
				model: target.label,
				calls: {
					total: calls.length,
					ok: okCalls,
					schemaRecovered: recoveredCalls,
					avgLatencyMs,
					medianLatencyMs: median(latenciesOk),
				},
				items: {
					total: rows.length,
					coveragePct: pct(found, rows.length),
					productTypeNonNullPct: pct(productTypeNonNull, found),
					everydayNameNonNullPct: pct(everydayNameNonNull, found),
					brandNonNullPct: pct(brandNonNull, found),
					amountNonNullPct: pct(amountNonNull, found),
					unitNonNullPct: pct(unitNonNull, found),
					packNonNullPct: pct(packNonNull, found),
					containerNonNullPct: pct(containerNonNull, found),
					brandMatchPct: pct(brandMatchCount, brandTruthPresent),
					amountUnitMatchPct: pct(amountMatchCount, amountTruthPresent),
					packMatchPct: pct(packMatchCount, packTruthPresent),
					containerMatchPct: pct(containerMatchCount, containerTruthPresent),
					avgConfidence:
						all
							.map((v) => v.confidence)
							.filter((v): v is number => typeof v === "number")
							.reduce((sum, v, _, arr) => sum + v / arr.length, 0) || null,
				},
				failures: calls.filter((c) => !c.parseOk).slice(0, 3),
			}),
		);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
