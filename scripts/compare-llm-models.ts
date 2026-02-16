/* eslint-disable no-console */
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { retailerItems } from "@/db";
import { parseCategorizationResponse } from "@/lib/categorization/parse";
import {
	parseEnsembleConfig,
	readApiKey,
	type EnsembleModelConfig,
} from "@/lib/semantic-clustering/config";
import { extractJsonPayload } from "@/lib/semantic-clustering/llm";
import { parseRetailerItemFeature } from "@/lib/semantic-clustering/normalize";
import { getDb } from "@/utils/bindings";

type ProviderKey = "openrouter" | "local" | "zai";

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

function loadRuntimeEnv(): void {
	// Staging runs with real env; local runs often rely on dotenv.
	if (process.env.DATABASE_URL && process.env.OPENROUTER_API_KEY) {
		return;
	}

	const envCandidates: string[] = [];
	if (process.env.NODE_ENV) {
		envCandidates.push(`.env.${process.env.NODE_ENV}.local`);
		envCandidates.push(`.env.${process.env.NODE_ENV}`);
	}
	envCandidates.push(
		".env.development.local",
		".env.local",
		".env.test",
		".env.development",
		".env",
	);

	for (const file of envCandidates) {
		if (!existsSync(file)) continue;
		loadDotenv({ path: file });
	}
}

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

function parseArgs(argv: string[]): {
	n: number;
	batch: number;
	outJson: string | null;
	skipLocal: boolean;
} {
	let n = parsePositiveInt(process.env.EVAL_N, 120);
	let batch = parsePositiveInt(process.env.EVAL_BATCH, 10);
	let outJson: string | null = null;
	let skipLocal = false;

	for (const arg of argv) {
		if (arg.startsWith("--n=")) n = parsePositiveInt(arg.split("=", 2)[1], n);
		if (arg.startsWith("--batch="))
			batch = parsePositiveInt(arg.split("=", 2)[1], batch);
		if (arg.startsWith("--out-json=")) outJson = arg.split("=", 2)[1] ?? null;
		if (arg === "--skip-local") skipLocal = true;
	}

	return {
		n: Math.min(1000, Math.max(20, n)),
		batch: Math.min(60, Math.max(5, batch)),
		outJson,
		skipLocal,
	};
}

function parseCsv(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
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
}): { parsed: Map<string, any>; schemaRecovered: boolean } {
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
		headers["HTTP-Referer"] =
			process.env.OPENROUTER_HTTP_REFERER ?? "https://kosarica.local";
		headers["X-Title"] = process.env.OPENROUTER_X_TITLE ?? "Kosarica LLM Compare";
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

function p90(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = values.slice().sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
	return sorted[index] ?? null;
}

async function listZaiModels(): Promise<string[]> {
	const apiKey = process.env.ZAI_API_KEY;
	if (!apiKey) return [];
	const res = await fetch("https://api.z.ai/api/coding/paas/v4/models", {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) {
		return [];
	}
	const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
	return (json.data ?? [])
		.map((m) => (typeof m.id === "string" ? m.id : null))
		.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function getLocalModelFromEnsemble(): EnsembleModelConfig | null {
	const raw = process.env.LLM_ENSEMBLE_JSON;
	if (!raw) return null;
	const parsed = parseEnsembleConfig(raw);
	if (parsed.length === 0) return null;

	// Heuristic: local providers are configured as OpenAI-compatible but with custom endpoint.
	const qwen =
		parsed.find((m) => m.model.includes("qwen/qwen3-4b")) ??
		parsed.find((m) => m.id.includes("qwen")) ??
		parsed[0] ??
		null;
	return qwen ? { ...qwen, provider: "openai" as const } : null;
}

async function sampleRetailerItems(db: ReturnType<typeof getDb>, n: number): Promise<ItemRow[]> {
	// `ORDER BY random()` is expensive on large tables. TABLESAMPLE is much cheaper.
	const sampleRatesPct = [0.05, 0.1, 0.2, 0.5, 1, 2, 5];

	for (const ratePct of sampleRatesPct) {
		// TABLESAMPLE expects a literal number; we inline from a fixed allowlist.
		const query = sql`
			select
				id,
				name,
				brand,
				category,
				subcategory,
				unit,
				unit_quantity as "unitQuantity",
				chain_slug as "chainSlug"
			from retailer_items
			tablesample system (${sql.raw(String(ratePct))})
			where merged_into_id is null
			limit ${n}
		`;

		const result = await db.execute(query);
		const rows = (((result as unknown) as { rows?: unknown[] }).rows ?? []) as ItemRow[];
		if (rows.length >= Math.min(n, 20)) {
			return rows.slice(0, n);
		}
	}

	// Fallback: deterministic top-N without sorting.
	const fallback = await db
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
		.limit(n);

	return fallback as ItemRow[];
}

async function main(): Promise<void> {
	loadRuntimeEnv();
	const { n, batch, outJson, skipLocal } = parseArgs(process.argv.slice(2));

	const db = getDb();
	const rows = await sampleRetailerItems(db, n);

	const llmIdByRealId = new Map<string, string>();
	for (const [index, row] of rows.entries()) {
		// Numeric-only IDs often get emitted as JSON numbers, which breaks strict schema parsing.
		llmIdByRealId.set(row.id, `i${index + 1}`);
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

	const localConfig = getLocalModelFromEnsemble();
	const zaiModels = await listZaiModels();

	const openrouterCandidatesFromEnv = parseCsv(process.env.EVAL_OPENROUTER_MODELS);
	const openrouterCandidates: string[] =
		openrouterCandidatesFromEnv.length > 0
			? openrouterCandidatesFromEnv
			: [
					// Historically best behaved (parseable JSON) for our strict JSON flow.
					"liquid/lfm-2.5-1.2b-instruct:free",
					"arcee-ai/trinity-large-preview:free",
					"arcee-ai/trinity-mini:free",
					"nvidia/nemotron-nano-9b-v2:free",
					"stepfun/step-3.5-flash:free",
					"openbmb/miniCPM-o-2_6:free",
				];

	const targets: ModelTarget[] = [];

	for (const model of openrouterCandidates) {
		targets.push({
			key: "openrouter",
			label: `openrouter:${model}`,
			config: {
				id: `openrouter:${model}`,
				provider: "openrouter",
				model,
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
		});
	}

	const zaiEndpoint = "https://api.z.ai/api/coding/paas/v4/chat/completions";
	const zaiFromEnv = parseCsv(process.env.EVAL_ZAI_MODELS);
	const zaiPreferred = [
		"glm-5",
		"glm-4.7",
		"glm-4.6",
		"glm-4.5-air",
		"glm-4.5",
	];
	const zaiToTest = (
		zaiFromEnv.length > 0
			? zaiFromEnv
			: [
					...zaiPreferred,
					...zaiModels.filter((m) => !zaiPreferred.includes(m)),
				]
	).filter((m, idx, arr) => arr.indexOf(m) === idx);

	for (const model of zaiToTest) {
		targets.push({
			key: "zai",
			label: `zai:${model}`,
			config: {
				id: `zai:${model}`,
				provider: "zai",
				model,
				endpoint: zaiEndpoint,
				apiKeyEnv: "ZAI_API_KEY",
				weight: 1,
				timeoutMs: 120_000,
				maxRetries: 0,
			},
			maxTokens: 3500,
			timeoutMs: 120_000,
			rpmLimit: 10,
			useResponseFormat: true,
		});
	}

	if (localConfig && !skipLocal) {
		targets.push({
			key: "local",
			label: `local:${localConfig.model}`,
			config: {
				...localConfig,
				id: "local",
				provider: "openai",
				apiKeyEnv: localConfig.apiKeyEnv ?? "LOCAL_LLM_API_KEY",
			},
			maxTokens: 2500,
			timeoutMs: 240_000,
			rpmLimit: null,
			useResponseFormat: false,
		});
	}

	const batches: ItemRow[][] = [];
	for (let index = 0; index < rows.length; index += batch) {
		batches.push(rows.slice(index, index + batch));
	}

	const runMeta = {
		startedAt: new Date().toISOString(),
		host: hostname(),
		n: rows.length,
		batch,
		batches: batches.length,
		targets: targets.map((t) => t.label),
	};

	console.error(
		`[llm-compare] startedAt=${runMeta.startedAt} host=${runMeta.host} items=${runMeta.n} batch=${runMeta.batch} targets=${runMeta.targets.length}`,
	);

	const perTarget: Array<{
		model: string;
		calls: {
			total: number;
			ok: number;
			schemaRecovered: number;
			avgLatencyMs: number | null;
			medianLatencyMs: number | null;
			p90LatencyMs: number | null;
		};
		items: {
			total: number;
			coveragePct: number;
			productTypeNonNullPct: number;
			everydayNameNonNullPct: number;
			brandNonNullPct: number;
			amountNonNullPct: number;
			unitNonNullPct: number;
			packNonNullPct: number;
			containerNonNullPct: number;
			brandMatchPct: number;
			amountUnitMatchPct: number;
			packMatchPct: number;
			containerMatchPct: number;
			avgConfidence: number | null;
		};
		failures: BatchRun[];
	}> = [];

	for (const target of targets) {
		console.error(`[llm-compare] target=${target.label} starting...`);
		const evalById = new Map<string, ItemEval>();
		const calls: BatchRun[] = [];

		const gapMs =
			target.rpmLimit && target.rpmLimit > 0
				? Math.ceil(60_000 / target.rpmLimit)
				: 0;
		let lastCallStart = 0;

		for (const [callIndex, batchRows] of batches.entries()) {
			if (callIndex % 3 === 0) {
				console.error(
					`[llm-compare] target=${target.label} call=${callIndex + 1}/${batches.length}`,
				);
			}
			if (gapMs > 0) {
				const now = Date.now();
				const waitMs = lastCallStart + gapMs - now;
				if (waitMs > 0) await sleep(waitMs);
				lastCallStart = Date.now();
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
				const payload = extractJsonPayload(response.contentText);
				const { parsed, schemaRecovered } = parseCategorizationFlexible({
					payload,
					expectedItemIds: expectedLlmIds,
				});

				for (const row of batchRows) {
					const llmId = llmIdByRealId.get(row.id) ?? row.id;
					const baseline = baselines.get(row.id) ?? null;
					const result = (parsed.get(llmId) as any) ?? null;
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
							brandMatch: baseline
								? brandMatches(null, baseline.extractedBrand ?? row.brand)
								: null,
							amountUnitMatch: baseline
								? amountUnitMatches(
										null,
										null,
										baseline.extractedAmount,
										baseline.extractedUnit,
									)
								: null,
							packMatch: baseline ? eqNullable(null, baseline.packAmount) : null,
							containerMatch: baseline
								? eqNullable(null, baseline.containerType)
								: null,
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
						packMatch: baseline
							? eqNullable(result.packAmount, baseline.packAmount)
							: null,
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
				});
			} catch (error) {
				const elapsedMs = Date.now() - startedAt;
				const message = error instanceof Error ? error.message : String(error);
				const errorStage: BatchRun["errorStage"] = (() => {
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
		const productTypeNonNull = all.filter(
			(v) => v.hasResult && v.productTypeNonNull,
		).length;
		const everydayNameNonNull = all.filter(
			(v) => v.hasResult && v.everydayNameNonNull,
		).length;
		const brandNonNull = all.filter((v) => v.hasResult && v.brandNonNull).length;
		const amountNonNull = all.filter((v) => v.hasResult && v.amountNonNull).length;
		const unitNonNull = all.filter((v) => v.hasResult && v.unitNonNull).length;
		const packNonNull = all.filter((v) => v.hasResult && v.packNonNull).length;
		const containerNonNull = all.filter(
			(v) => v.hasResult && v.containerNonNull,
		).length;

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

		perTarget.push({
			model: target.label,
			calls: {
				total: calls.length,
				ok: okCalls,
				schemaRecovered: recoveredCalls,
				avgLatencyMs,
				medianLatencyMs: median(latenciesOk),
				p90LatencyMs: p90(latenciesOk),
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
			failures: calls.filter((c) => !c.parseOk).slice(0, 5),
		});
		console.error(`[llm-compare] target=${target.label} done.`);
	}

	const result = {
		...runMeta,
		results: perTarget,
	};

	const jsonText = JSON.stringify(result, null, 2);
	console.log(jsonText);

	if (outJson) {
		const { writeFileSync } = await import("node:fs");
		writeFileSync(outJson, jsonText, "utf8");
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
