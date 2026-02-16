import type { EnsembleModelConfig } from "@/lib/semantic-clustering/config";

export interface VertexExpressUsage {
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
}

export interface VertexExpressGenerateContentResult {
	responseJson: unknown;
	responseText: string;
	usage: VertexExpressUsage;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Simple in-process rate limiter to stay under provider RPM caps.
// This is intentionally conservative (serializes requests in a single process).
let vertexExpressNextAllowedAtMs = 0;
let vertexExpressGate: Promise<void> = Promise.resolve();

async function waitForVertexExpressRateLimit(): Promise<void> {
	const rpm = parsePositiveIntEnv("VERTEX_EXPRESS_RPM", 10);
	const minIntervalMs = Math.ceil(60_000 / rpm);

	vertexExpressGate = vertexExpressGate.then(async () => {
		const now = Date.now();
		const scheduled = Math.max(now, vertexExpressNextAllowedAtMs);
		const delayMs = scheduled - now;
		vertexExpressNextAllowedAtMs = scheduled + minIntervalMs;
		if (delayMs > 0) {
			await new Promise((resolve) => {
				setTimeout(resolve, delayMs);
			});
		}
	});

	await vertexExpressGate;
}

class VertexExpressHttpError extends Error {
	public readonly status: number;

	public readonly statusText: string;

	public readonly bodySnippet: string;

	public constructor(input: {
		message: string;
		status: number;
		statusText: string;
		bodySnippet: string;
	}) {
		super(input.message);
		this.status = input.status;
		this.statusText = input.statusText;
		this.bodySnippet = input.bodySnippet;
	}
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripModelSuffix(model: string): string {
	return model.split(":")[0]?.trim() ?? "";
}

export function toVertexExpressModelPath(model: string): string {
	const trimmed = stripModelSuffix(model).replace(/^\/+/, "");
	if (trimmed.length === 0) {
		throw new Error("Vertex model is empty");
	}

	if (trimmed.startsWith("v1/")) {
		return trimmed.slice("v1/".length);
	}
	if (trimmed.startsWith("v1beta1/")) {
		return trimmed.slice("v1beta1/".length);
	}
	if (trimmed.startsWith("publishers/")) {
		return trimmed;
	}

	// Express mode uses a global endpoint without projects/locations. Prefer the
	// publisher model path form: publishers/google/models/<model>.
	return `publishers/google/models/${trimmed}`;
}

export function buildVertexExpressUrl(input: {
	baseEndpoint: string;
	model: string;
	apiKey: string;
}): { url: string; redacted: string } {
	const base = input.baseEndpoint.replace(/\/+$/, "");
	const modelPath = toVertexExpressModelPath(input.model).replace(/^\/+/, "");
	const url = `${base}/${modelPath}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
	const redacted = `${base}/${modelPath}:generateContent?key=REDACTED`;
	return { url, redacted };
}

export function extractVertexText(responseJson: unknown): string {
	if (!isRecord(responseJson)) {
		throw new Error("Vertex response body is invalid");
	}
	const candidates = responseJson.candidates;
	if (!Array.isArray(candidates) || candidates.length === 0) {
		throw new Error("Vertex response has no candidates");
	}
	const first = candidates[0];
	if (!isRecord(first)) {
		throw new Error("Vertex response candidate is invalid");
	}
	const content = first.content;
	if (!isRecord(content)) {
		throw new Error("Vertex response candidate content is missing");
	}
	const parts = content.parts;
	if (!Array.isArray(parts) || parts.length === 0) {
		throw new Error("Vertex response candidate parts are missing");
	}

	const text = parts
		.map((part) => {
			if (!isRecord(part)) {
				return "";
			}
			return typeof part.text === "string" ? part.text : "";
		})
		.join("")
		.trim();

	if (text.length === 0) {
		throw new Error("Vertex response text is empty");
	}
	return text;
}

export function extractVertexUsage(responseJson: unknown): VertexExpressUsage {
	if (!isRecord(responseJson)) {
		return { promptTokens: null, completionTokens: null, totalTokens: null };
	}
	const usageMetadata = responseJson.usageMetadata;
	if (!isRecord(usageMetadata)) {
		return { promptTokens: null, completionTokens: null, totalTokens: null };
	}

	return {
		promptTokens: toFiniteNumber(usageMetadata.promptTokenCount),
		completionTokens: toFiniteNumber(usageMetadata.candidatesTokenCount),
		totalTokens: toFiniteNumber(usageMetadata.totalTokenCount),
	};
}

function isLikelySchemaOrMimeTypeError(status: number, bodyText: string): boolean {
	if (status !== 400 && status !== 422) {
		return false;
	}
	return /responseSchema|responseMimeType|maxOutputTokens|generationConfig|INVALID_ARGUMENT|schema|mime/i.test(
		bodyText,
	);
}

async function postGenerateContent(input: {
	config: EnsembleModelConfig;
	systemMsg: string;
	userMsg: string;
	apiKey: string;
	responseSchema?: Record<string, unknown>;
	responseMimeType?: string;
}): Promise<VertexExpressGenerateContentResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);

	try {
		await waitForVertexExpressRateLimit();

		const { url } = buildVertexExpressUrl({
			baseEndpoint: input.config.endpoint ?? "",
			model: input.config.model,
			apiKey: input.apiKey,
		});

		const generationConfig: Record<string, unknown> = {
			temperature: 0,
			maxOutputTokens: input.config.maxTokens ?? 6000,
		};

		if (input.responseMimeType) {
			generationConfig.responseMimeType = input.responseMimeType;
		}
		if (input.responseSchema) {
			generationConfig.responseSchema = input.responseSchema;
		}

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// Some Google APIs accept the key via query param, some via header.
				// Sending both is harmless and avoids auth failures in mixed environments.
				"x-goog-api-key": input.apiKey,
			},
			body: JSON.stringify({
				systemInstruction: {
					parts: [{ text: input.systemMsg }],
				},
				contents: [
					{
						role: "user",
						parts: [{ text: input.userMsg }],
					},
				],
				generationConfig,
			}),
			signal: controller.signal,
		});

		// Vertex normally returns JSON, but on network/proxy failures we can see
		// non-JSON bodies (HTML/text). Parse defensively so errors are actionable.
		const bodyText = await response.text();
		const responseJson = (() => {
			try {
				return JSON.parse(bodyText) as unknown;
			} catch {
				return null;
			}
		})();

		if (!response.ok) {
			const bodySnippet = bodyText.slice(0, 280);
			throw new VertexExpressHttpError({
				message: `${input.config.provider}:${input.config.model} HTTP ${response.status} ${response.statusText} body=${bodySnippet}`,
				status: response.status,
				statusText: response.statusText,
				bodySnippet,
			});
		}

		if (responseJson == null) {
			const bodySnippet = bodyText.slice(0, 280);
			throw new Error(
				`${input.config.provider}:${input.config.model} returned non-JSON body: ${bodySnippet}`,
			);
		}

		const responseText = extractVertexText(responseJson);
		return {
			responseJson,
			responseText,
			usage: extractVertexUsage(responseJson),
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function callVertexExpressGenerateContent(input: {
	config: EnsembleModelConfig;
	systemMsg: string;
	userMsg: string;
	responseSchema?: Record<string, unknown>;
	responseMimeType?: string;
}): Promise<VertexExpressGenerateContentResult> {
	const apiKeyEnv = input.config.apiKeyEnv ?? "VERTEX_EXPRESS_API_KEY";
	const apiKey = process.env[apiKeyEnv];
	if (!apiKey) {
		throw new Error(`Missing API key for model ${input.config.id}: set ${apiKeyEnv}`);
	}

	const attempts: Array<{
		responseSchema?: Record<string, unknown>;
		responseMimeType?: string;
	}> = [];

	// Prefer schema+mime type when provided. On format/schema errors, fall back
	// to mime-only, then to plain text.
	if (input.responseSchema) {
		attempts.push({
			responseSchema: input.responseSchema,
			responseMimeType: input.responseMimeType ?? "application/json",
		});
		attempts.push({
			responseMimeType: input.responseMimeType ?? "application/json",
		});
		attempts.push({});
	} else if (input.responseMimeType) {
		attempts.push({ responseMimeType: input.responseMimeType });
		attempts.push({});
	} else {
		attempts.push({});
	}

	let lastError: Error | null = null;
	for (const [index, attempt] of attempts.entries()) {
		try {
			return await postGenerateContent({
				config: input.config,
				systemMsg: input.systemMsg,
				userMsg: input.userMsg,
				apiKey,
				responseSchema: attempt.responseSchema,
				responseMimeType: attempt.responseMimeType,
			});
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			const isLastAttempt = index === attempts.length - 1;

			if (
				!isLastAttempt &&
				error instanceof VertexExpressHttpError &&
				isLikelySchemaOrMimeTypeError(error.status, error.bodySnippet)
			) {
				continue;
			}
			if (!isLastAttempt) {
				break;
			}
		}
	}

	throw lastError ?? new Error("Vertex express request failed");
}
