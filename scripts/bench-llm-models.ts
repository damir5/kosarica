/* eslint-disable no-console */
import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { extractJsonPayload } from "@/lib/semantic-clustering/llm";

type Provider = "openrouter" | "zai" | "local";

type ChatMessage = { role: "system" | "user"; content: string };

type ModelTarget = {
	provider: Provider;
	model: string;
	endpoint: string;
	apiKeyEnv: string;
};

type BenchResult = {
	provider: Provider;
	model: string;
	round: number;
	ok: boolean;
	httpStatus: number | null;
	latencyMs: number;
	parseOk: boolean;
	resultCount: number | null;
	usage: {
		promptTokens: number | null;
		completionTokens: number | null;
		totalTokens: number | null;
	} | null;
	error: string | null;
};

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const ZAI_ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const DEFAULT_LOCAL_ENDPOINT = "http://100.72.112.119:1234/v1/chat/completions";

const FREE_OPENROUTER_MODELS: string[] = [
	"arcee-ai/trinity-large-preview:free",
	"arcee-ai/trinity-mini:free",
	"cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
	"deepseek/deepseek-r1-0528:free",
	"google/gemma-3-12b-it:free",
	"google/gemma-3-27b-it:free",
	"google/gemma-3-4b-it:free",
	"google/gemma-3n-e2b-it:free",
	"google/gemma-3n-e4b-it:free",
	"liquid/lfm-2.5-1.2b-instruct:free",
	"liquid/lfm-2.5-1.2b-thinking:free",
	"meta-llama/llama-3.2-3b-instruct:free",
	"meta-llama/llama-3.3-70b-instruct:free",
	"mistralai/mistral-small-3.1-24b-instruct:free",
	"nousresearch/hermes-3-llama-3.1-405b:free",
	"nvidia/nemotron-3-nano-30b-a3b:free",
	"nvidia/nemotron-nano-12b-v2-vl:free",
	"nvidia/nemotron-nano-9b-v2:free",
	"openai/gpt-oss-120b:free",
	"openai/gpt-oss-20b:free",
	"qwen/qwen3-4b:free",
	"qwen/qwen3-coder:free",
	"qwen/qwen3-next-80b-a3b-instruct:free",
	"stepfun/step-3.5-flash:free",
	"upstage/solar-pro-3:free",
	"z-ai/glm-4.5-air:free",
];

function loadRuntimeEnv(): void {
	// Staging runs with real env; local runs often rely on dotenv.
	if (process.env.OPENROUTER_API_KEY || process.env.ZAI_API_KEY) {
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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function formatMs(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "-";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function parseArgs(argv: string[]): {
	mode: "all" | "only-local" | "only-openrouter" | "only-zai";
	rounds: number;
	rpm: number;
	includeLocal: boolean;
	includeZai: boolean;
	localModel: string;
	localEndpoint: string;
	items: number;
	maxTokens: number;
	timeoutMs: number;
	localTimeoutMs: number;
	models: string[];
} {
	let mode: "all" | "only-local" | "only-openrouter" | "only-zai" = "all";
	let rounds = parsePositiveInt(process.env.BENCH_ROUNDS, 1);
	let rpm = parsePositiveInt(process.env.BENCH_RPM, 10);
	let includeLocal = (process.env.BENCH_INCLUDE_LOCAL ?? "1") !== "0";
	let includeZai = (process.env.BENCH_INCLUDE_ZAI ?? "1") !== "0";
	let localModel = process.env.BENCH_LOCAL_MODEL ?? "qwen/qwen3-4b";
	let localEndpoint = process.env.BENCH_LOCAL_ENDPOINT ?? DEFAULT_LOCAL_ENDPOINT;
	let items = parsePositiveInt(process.env.BENCH_ITEMS, 10);
	let maxTokens = parsePositiveInt(process.env.BENCH_MAX_TOKENS, 1200);
	let timeoutMs = parsePositiveInt(process.env.BENCH_TIMEOUT_MS, 60_000);
	let localTimeoutMs = parsePositiveInt(
		process.env.BENCH_LOCAL_TIMEOUT_MS,
		180_000,
	);
	let models = parseCsv(process.env.BENCH_MODELS);

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--only-local") {
			mode = "only-local";
			includeLocal = true;
			continue; // eslint-disable-line no-continue
		}
		if (arg === "--only-openrouter") {
			mode = "only-openrouter";
			includeLocal = false;
			includeZai = false;
			continue; // eslint-disable-line no-continue
		}
		if (arg === "--only-zai") {
			mode = "only-zai";
			includeLocal = false;
			includeZai = true;
			continue; // eslint-disable-line no-continue
		}
		if (arg === "--rounds") {
			const next = argv[index + 1];
			if (next) {
				rounds = parsePositiveInt(next, rounds);
				index += 1;
			}
			continue; // eslint-disable-line no-continue
		}
		if (arg === "--rpm") {
			const next = argv[index + 1];
			if (next) {
				rpm = parsePositiveInt(next, rpm);
				index += 1;
			}
			continue; // eslint-disable-line no-continue
		}
		if (arg === "--include-local") {
			includeLocal = true;
			// eslint-disable-next-line no-continue
			continue;
		}
		if (arg === "--no-local") {
			includeLocal = false;
			// eslint-disable-next-line no-continue
			continue;
		}
		if (arg === "--include-zai") {
			includeZai = true;
			// eslint-disable-next-line no-continue
			continue;
		}
		if (arg === "--no-zai") {
			includeZai = false;
			// eslint-disable-next-line no-continue
			continue;
		}
		if (arg.startsWith("--rounds=")) {
			rounds = parsePositiveInt(arg.split("=", 2)[1], rounds);
			// eslint-disable-next-line no-continue
			continue;
		}
		if (arg.startsWith("--rpm=")) {
			rpm = parsePositiveInt(arg.split("=", 2)[1], rpm);
			// eslint-disable-next-line no-continue
			continue;
		}
		if (arg.startsWith("--local-model=")) {
			localModel = arg.split("=", 2)[1] ?? localModel;
			// eslint-disable-next-line no-continue
			continue;
		}
		if (arg.startsWith("--local-endpoint=")) {
			localEndpoint = arg.split("=", 2)[1] ?? localEndpoint;
			continue; // eslint-disable-line no-continue
		}
		if (arg.startsWith("--items=")) {
			items = parsePositiveInt(arg.split("=", 2)[1], items);
			continue; // eslint-disable-line no-continue
		}
		if (arg.startsWith("--max-tokens=")) {
			maxTokens = parsePositiveInt(arg.split("=", 2)[1], maxTokens);
			continue; // eslint-disable-line no-continue
		}
		if (arg.startsWith("--timeout-ms=")) {
			timeoutMs = parsePositiveInt(arg.split("=", 2)[1], timeoutMs);
			continue; // eslint-disable-line no-continue
		}
		if (arg.startsWith("--local-timeout-ms=")) {
			localTimeoutMs = parsePositiveInt(
				arg.split("=", 2)[1],
				localTimeoutMs,
			);
			continue; // eslint-disable-line no-continue
		}
		if (arg.startsWith("--models=")) {
			models = parseCsv(arg.split("=", 2)[1]);
			continue; // eslint-disable-line no-continue
		}
	}

	return {
		mode,
		rounds,
		rpm,
		includeLocal,
		includeZai,
		localModel,
		localEndpoint,
		items: Math.min(50, Math.max(1, items)),
		maxTokens: Math.min(4000, Math.max(16, maxTokens)),
		timeoutMs: Math.min(600_000, Math.max(1_000, timeoutMs)),
		localTimeoutMs: Math.min(600_000, Math.max(1_000, localTimeoutMs)),
		models,
	};
}

function buildCategorizationBenchmarkMessages(options: {
	items: number;
}): ChatMessage[] {
	const items = [
		{ item_id: "itm_1", name: "Coca-Cola Zero 0,5L", brand_hint: "Coca-Cola" },
		{ item_id: "itm_2", name: "Jamnica mineralna voda 1,5L", brand_hint: "Jamnica" },
		{ item_id: "itm_3", name: "Dukat jogurt 1kg", brand_hint: "Dukat" },
		{ item_id: "itm_4", name: "Kraš Dorina mliječna čokolada 100g", brand_hint: "Kraš" },
		{ item_id: "itm_5", name: "Podravka Vegeta 250g", brand_hint: "Podravka" },
		{ item_id: "itm_6", name: "Cedevita naranča 1kg", brand_hint: "Cedevita" },
		{ item_id: "itm_7", name: "Zbregov svježe mlijeko 2,8% m.m. 1L", brand_hint: "Vindija" },
		{ item_id: "itm_8", name: "Lino Lada Gold 350g", brand_hint: "Podravka" },
		{ item_id: "itm_9", name: "Pik šunka u ovitku 100g", brand_hint: "Pik" },
		{ item_id: "itm_10", name: "Barilla Penne Rigate 500g", brand_hint: "Barilla" },
	].slice(0, options.items);

	const system = [
		"You are a Croatian grocery product categorization expert.",
		"Return strict JSON only. No markdown, no extra text.",
		"For each item, extract:",
		"- everyday_name: short consumer-friendly name in Croatian",
		"- product_type: short category label (e.g. 'mlijeko', 'tjestenina', 'čokolada', 'voda', 'bezalkoholno piće')",
		"- brand: best guess or null",
		"- variant: flavor/type/descriptor or null",
		"- search_tags: array of up to 6 short strings",
		"- extracted_amount: number or null",
		"- extracted_unit: one of 'g','kg','ml','l','kom' or null",
		"- pack_amount: integer >=1",
		"- container_type: one of 'pet','limenka','staklo','tetrapak','tuba' or null",
		"- confidence: number 0..1",
		"Output shape:",
		`{"results":[{"item_id":"...","everyday_name":"...","product_type":"...","brand":"...","variant":null,"search_tags":[],"extracted_amount":null,"extracted_unit":null,"pack_amount":1,"container_type":null,"confidence":0.0}]}`,
	].join("\n");

	const user = `Items:\n${JSON.stringify(items)}`;

	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
}

function shouldRetryWithoutResponseFormat(status: number, bodyText: string): boolean {
	if (status !== 400 && status !== 422) return false;
	return /response[_\s-]?format|json_schema|json_object|unsupported/i.test(bodyText);
}

async function listOpenRouterFreeModels(): Promise<string[]> {
	try {
		const res = await fetch(OPENROUTER_MODELS_ENDPOINT);
		if (!res.ok) return [];
		const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
		return (json.data ?? [])
			.map((m) => (typeof m.id === "string" ? m.id : null))
			.filter((id): id is string => typeof id === "string" && id.includes(":free"));
	} catch {
		return [];
	}
}

async function listZaiModels(): Promise<string[]> {
	try {
		const apiKey = process.env.ZAI_API_KEY ?? "";
		if (apiKey.trim().length === 0) return [];
		const res = await fetch("https://api.z.ai/api/coding/paas/v4/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) return [];
		const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
		return (json.data ?? [])
			.map((m) => (typeof m.id === "string" ? m.id : null))
			.filter((id): id is string => typeof id === "string" && id.length > 0);
	} catch {
		return [];
	}
}

async function callChatCompletion(input: {
	target: ModelTarget;
	messages: ChatMessage[];
	timeoutMs: number;
	maxTokens: number;
}): Promise<{
	httpStatus: number;
	latencyMs: number;
	bodyText: string;
	usage: BenchResult["usage"];
	contentText: string | null;
}> {
	const apiKey = process.env[input.target.apiKeyEnv] ?? "";
	if (apiKey.trim().length === 0) {
		throw new Error(`Missing env var ${input.target.apiKeyEnv} for ${input.target.provider}`);
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
	const startedAt = Date.now();

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};
	if (input.target.provider === "openrouter") {
		headers["HTTP-Referer"] = "https://kosarica.local";
		headers["X-Title"] = "Kosarica LLM Bench";
	}

	const makeBody = (withResponseFormat: boolean): string => JSON.stringify({
		model: input.target.model,
		temperature: 0,
		max_tokens: input.maxTokens,
		...(withResponseFormat ? { response_format: { type: "json_object" } } : {}),
		messages: input.messages,
	});

	const doRequest = async (withResponseFormat: boolean) => {
		const response = await fetch(input.target.endpoint, {
			method: "POST",
			headers,
			body: makeBody(withResponseFormat),
			signal: controller.signal,
		});
		const bodyText = await response.text();
		return { response, bodyText };
	};

	try {
		let attempt = await doRequest(true);
		if (!attempt.response.ok && shouldRetryWithoutResponseFormat(attempt.response.status, attempt.bodyText)) {
			attempt = await doRequest(false);
		}

		const latencyMs = Date.now() - startedAt;
		const httpStatus = attempt.response.status;

		let usage: BenchResult["usage"] = null;
		let contentText: string | null = null;

		if (attempt.bodyText.trim().length > 0) {
			try {
				const parsed = JSON.parse(attempt.bodyText) as {
					choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }>;
					usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
				};
				const choice = parsed.choices?.[0]?.message;
				const choiceContent = choice?.content;
				if (typeof choiceContent === "string") {
					contentText = choiceContent;
				} else if (Array.isArray(choiceContent)) {
					const joined = choiceContent
						.map((part) => {
							if (part && typeof part === "object") {
								const text = (part as { text?: unknown }).text;
								return typeof text === "string" ? text : "";
							}
							return "";
						})
						.join("")
						.trim();
					contentText = joined.length > 0 ? joined : null;
				}
				if (!contentText || contentText.trim().length === 0) {
					const reasoning = choice?.reasoning;
					if (typeof reasoning === "string" && reasoning.trim().length > 0) {
						contentText = reasoning.trim();
					}
				}

				const u = parsed.usage;
				if (u) {
					usage = {
						promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : null,
						completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : null,
						totalTokens: typeof u.total_tokens === "number" ? u.total_tokens : null,
					};
				}
			} catch {
				// ignore JSON parse failures at this layer; caller will record it.
			}
		}

		return {
			httpStatus,
			latencyMs,
			bodyText: attempt.bodyText,
			usage,
			contentText,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function extractResultCount(payload: unknown): number | null {
	if (!payload || typeof payload !== "object") return null;
	const results = (payload as { results?: unknown }).results;
	return Array.isArray(results) ? results.length : null;
}

function quantile(values: number[], q: number): number | null {
	if (values.length === 0) return null;
	const sorted = values.slice().sort((a, b) => a - b);
	const pos = (sorted.length - 1) * q;
	const base = Math.floor(pos);
	const rest = pos - base;
	const baseVal = sorted[base]!;
	const nextVal = sorted[Math.min(sorted.length - 1, base + 1)]!;
	return baseVal + rest * (nextVal - baseVal);
}

function summarize(results: BenchResult[]): Array<{
	provider: Provider;
	model: string;
	okRate: number;
	parseRate: number;
	p50Ms: number | null;
	p95Ms: number | null;
	avgMs: number | null;
}> {
	const byKey = new Map<string, BenchResult[]>();
	for (const res of results) {
		const key = `${res.provider}|${res.model}`;
		const group = byKey.get(key) ?? [];
		group.push(res);
		byKey.set(key, group);
	}

	const rows: Array<{
		provider: Provider;
		model: string;
		okRate: number;
		parseRate: number;
		p50Ms: number | null;
		p95Ms: number | null;
		avgMs: number | null;
	}> = [];

	for (const [key, group] of byKey.entries()) {
		const [provider, model] = key.split("|") as [Provider, string];
		const latencies = group.filter((g) => g.ok).map((g) => g.latencyMs);
		const okCount = group.filter((g) => g.ok).length;
		const parseCount = group.filter((g) => g.parseOk).length;
		const avg = latencies.length > 0 ? latencies.reduce((sum, v) => sum + v, 0) / latencies.length : null;
		rows.push({
			provider,
			model,
			okRate: group.length > 0 ? okCount / group.length : 0,
			parseRate: group.length > 0 ? parseCount / group.length : 0,
			p50Ms: quantile(latencies, 0.5),
			p95Ms: quantile(latencies, 0.95),
			avgMs: avg,
		});
	}

	rows.sort((a, b) => {
		const aScore = (a.p50Ms ?? Number.POSITIVE_INFINITY);
		const bScore = (b.p50Ms ?? Number.POSITIVE_INFINITY);
		return aScore - bScore;
	});

	return rows;
}

async function main(): Promise<void> {
	loadRuntimeEnv();
	const {
		mode,
		rounds,
		rpm,
		includeLocal,
		includeZai,
		localModel,
		localEndpoint,
		items,
		maxTokens,
		timeoutMs,
		localTimeoutMs,
		models,
	} = parseArgs(process.argv.slice(2));
	const messages = buildCategorizationBenchmarkMessages({ items });

	const discoveredOpenRouterFree =
		mode !== "only-local" && mode !== "only-zai" && models.length === 0
			? await listOpenRouterFreeModels()
			: [];
	const openrouterModels =
		mode !== "only-local" && mode !== "only-zai"
			? (models.length > 0
					? models
					: (discoveredOpenRouterFree.length > 0
							? discoveredOpenRouterFree
							: FREE_OPENROUTER_MODELS))
			: [];

	const targets: ModelTarget[] = [
		...(mode !== "only-local" && mode !== "only-zai"
			? openrouterModels.map((model) => ({
					provider: "openrouter" as const,
					model,
					endpoint: OPENROUTER_ENDPOINT,
					apiKeyEnv: "OPENROUTER_API_KEY",
				}))
			: []),
	];

	if (includeZai && mode !== "only-local") {
		const zaiModels = await listZaiModels();
		for (const model of zaiModels) {
			targets.push({
				provider: "zai",
				model,
				endpoint: ZAI_ENDPOINT,
				apiKeyEnv: "ZAI_API_KEY",
			});
		}
	}

	if (includeLocal && mode !== "only-openrouter") {
		targets.push({
			provider: "local",
			model: localModel,
			endpoint: localEndpoint,
			apiKeyEnv: "LOCAL_LLM_API_KEY",
		});
	}

	const minGapMs = Math.max(0, Math.floor(60_000 / Math.max(1, rpm)));
	let lastStartedAt = 0;

	const results: BenchResult[] = [];

	console.log(JSON.stringify({
		startedAt: new Date().toISOString(),
		rounds,
		rpm,
		targetCount: targets.length,
		includeLocal,
		includeZai,
		discoveredOpenRouterFreeCount: discoveredOpenRouterFree.length,
		localModel,
		localEndpoint,
		items,
		maxTokens,
		timeoutMs,
		localTimeoutMs,
		mode,
	}));

	// Warm up the local model once; first request often includes model load time.
	if (includeLocal && mode !== "only-openrouter") {
		try {
			await callChatCompletion({
				target: {
					provider: "local",
					model: localModel,
					endpoint: localEndpoint,
					apiKeyEnv: "LOCAL_LLM_API_KEY",
				},
				messages,
				timeoutMs: localTimeoutMs,
				maxTokens: Math.min(maxTokens, 256),
			});
			console.log(JSON.stringify({ label: "local:warmup", ok: true }));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.log(JSON.stringify({ label: "local:warmup", ok: false, error: message.slice(0, 240) }));
		}
	}

	for (const target of targets) {
		for (let round = 1; round <= rounds; round += 1) {
			if (target.provider === "openrouter" || target.provider === "zai") {
				const now = Date.now();
				const waitMs = (lastStartedAt + minGapMs) - now;
				if (waitMs > 0) {
					await sleep(waitMs);
				}
				lastStartedAt = Date.now();
			}

			const label = `${target.provider}:${target.model}#${round}`;
			const startedAt = Date.now();

			try {
				const response = await callChatCompletion({
					target,
					messages,
					timeoutMs: target.provider === "local" ? localTimeoutMs : timeoutMs,
					maxTokens,
				});

				const ok = response.httpStatus >= 200 && response.httpStatus < 300;
				let parseOk = false;
				let resultCount: number | null = null;
				const errorSnippet = ok ? "" : response.bodyText.slice(0, 240).replace(/\s+/g, " ");

				if (ok) {
					const content = response.contentText ?? "";
					try {
						const payload = extractJsonPayload(content);
						parseOk = true;
						resultCount = extractResultCount(payload);
					} catch {
						parseOk = false;
					}
				}

				const latencyMs = response.latencyMs;
				const elapsedMs = Date.now() - startedAt;
				const overheadMs = Math.max(0, elapsedMs - latencyMs);

				results.push({
					provider: target.provider,
					model: target.model,
					round,
					ok,
					httpStatus: response.httpStatus,
					latencyMs,
					parseOk,
					resultCount,
					usage: response.usage,
					error: ok ? null : errorSnippet,
				});

				console.log(JSON.stringify({
					label,
					ok,
					httpStatus: response.httpStatus,
					latencyMs,
					latency: formatMs(latencyMs),
					parseOk,
					resultCount,
					usage: response.usage,
					overheadMs,
					...(ok ? {} : { error: errorSnippet }),
				}));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const latencyMs = Date.now() - startedAt;
				results.push({
					provider: target.provider,
					model: target.model,
					round,
					ok: false,
					httpStatus: null,
					latencyMs,
					parseOk: false,
					resultCount: null,
					usage: null,
					error: message.slice(0, 400),
				});
				console.log(JSON.stringify({
					label,
					ok: false,
					httpStatus: null,
					latencyMs,
					latency: formatMs(latencyMs),
					parseOk: false,
					error: message,
				}));
			}
		}
	}

	const summary = summarize(results);
	console.log(JSON.stringify({
		finishedAt: new Date().toISOString(),
		summary,
	}, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
