import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
	type DatabaseType,
	ingestionRuns,
	retailerItemFeatures,
	retailerItems,
} from "@/db";
import { chunk } from "@/lib/collections/chunk";
import { callVertexExpressGenerateContent } from "@/lib/llm/vertex-express";
import {
	chooseEndpointForCapability,
	endpointToModelConfig,
	recordEndpointResult,
} from "@/lib/llm-routing";
import { logLlmDecision } from "@/lib/llm-observability";
import {
	type EnsembleModelConfig,
	readApiKey,
} from "@/lib/semantic-clustering/config";
import { extractJsonPayload } from "@/lib/semantic-clustering/llm";
import { parseRetailerItemFeature } from "@/lib/semantic-clustering/normalize";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger, errorToObject } from "@/utils/logger";
import {
	categorizationsAgree,
	type ParsedCategorization,
	parseCategorizationResponse,
} from "./parse";
import {
	buildCategorizationMessages,
	type CategorizationPromptItem,
} from "./prompt";

const log = createLogger("matching");

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

interface CategorizationInputRow extends CategorizationPromptItem {
	categoryOverrideBy: string | null;
	unitOverrideBy: string | null;
}

interface PersistedCategorization {
	itemId: string;
	everydayName: string | null;
	productType: string | null;
	brand: string | null;
	variant: string | null;
	searchTags: string[];
	extractedAmount: number | null;
	extractedUnit: string | null;
	packAmount: number | null;
	containerType: string | null;
	confidence: number;
	modelId: string;
	needsReview: boolean;
}

async function tryLogCategorizationDecision(input: {
	model: EnsembleModelConfig;
	itemIds: string[];
	rawOutput: unknown;
	parsed: Map<string, { confidence: number }>;
	latencyMs: number;
	stage: "primary" | "secondary";
}): Promise<void> {
	try {
		const confidences = Array.from(input.parsed.values()).map(
			(value) => value.confidence,
		);
		const avgConfidence =
			confidences.length > 0
				? confidences.reduce((sum, value) => sum + value, 0) /
					confidences.length
				: null;
		await logLlmDecision({
			taskType: "categorize",
			input: {
				stage: input.stage,
				itemIds: input.itemIds,
				itemCount: input.itemIds.length,
			},
			output: {
				resultCount: input.parsed.size,
				avgConfidence,
				raw: input.rawOutput,
			},
			modelId: input.model.model,
			provider: input.model.provider,
			endpointId: input.model.id,
			latencyMs: input.latencyMs,
			verdict: "BATCH_CATEGORIZATION",
			confidence: avgConfidence,
			reasoning: `${input.stage} categorization pass`,
		});
	} catch (error) {
		log.warn("Failed to log categorization LLM decision", {
			error: errorToObject(error),
			stage: input.stage,
		});
	}
}

export interface CategorizationBatchResult {
	succeeded: number;
	failed: number;
	escalated: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseConfidenceThreshold(raw: string | undefined): number {
	if (!raw) {
		return DEFAULT_CONFIDENCE_THRESHOLD;
	}
	const parsed = Number.parseFloat(raw);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_CONFIDENCE_THRESHOLD;
	}
	return Math.max(0, Math.min(1, parsed));
}

async function getCategorizationModels(): Promise<{
	primaryModel: EnsembleModelConfig;
	secondaryModel: EnsembleModelConfig | null;
}> {
	const primaryDecision = await chooseEndpointForCapability(
		"categorization_primary",
	);
	const secondaryDecision = await chooseEndpointForCapability(
		"categorization_secondary",
	);
	return {
		primaryModel: endpointToModelConfig(primaryDecision),
		secondaryModel: endpointToModelConfig(secondaryDecision),
	};
}

function isOpenAiCompatibleProvider(config: EnsembleModelConfig): boolean {
	return (
		config.provider === "openrouter" ||
		config.provider === "openai" ||
		config.provider === "zai"
	);
}

function isLikelyResponseFormatError(
	status: number,
	bodyText: string,
): boolean {
	if (status !== 400 && status !== 422) {
		return false;
	}
	return /response[_\s-]?format|json_schema|json_object|unsupported\s+media\s+type/i.test(
		bodyText,
	);
}

function extractMessageContent(data: unknown): string {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid response payload from LLM provider");
	}

	const choices = (
		data as {
			choices?: Array<{
				message?: { content?: unknown };
			}>;
		}
	).choices;
	const content = choices?.[0]?.message?.content;
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		const joined = content
			.map((part) => {
				if (part && typeof part === "object") {
					const text = (part as { text?: unknown }).text;
					return typeof text === "string" ? text : "";
				}
				return "";
			})
			.join("")
			.trim();
		if (joined.length > 0) {
			return joined;
		}
	}
	throw new Error("No message content returned by LLM provider");
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

type RpmLimiter = {
	wait: () => Promise<void>;
};

function createRpmLimiter(rpm: number): RpmLimiter {
	const safeRpm = Math.max(1, Math.floor(rpm));
	const gapMs = Math.ceil(60_000 / safeRpm);

	// Reserve start times with a fixed minimum gap, but do not serialize the actual requests.
	// This keeps us under the RPM cap while allowing multiple in-flight calls.
	let stateChain: Promise<void> = Promise.resolve();
	let nextAllowedAt = 0;

	return {
		wait: async () => {
			let scheduledAt = 0;
			const step = stateChain.then(() => {
				const now = Date.now();
				scheduledAt = Math.max(now, nextAllowedAt);
				nextAllowedAt = scheduledAt + gapMs;
			});

			stateChain = step.catch(() => {
				// Keep the chain alive even if a caller fails.
			});
			await step;

			const waitMs = scheduledAt - Date.now();
			if (waitMs > 0) {
				await sleep(waitMs);
			}
		},
	};
}

const CATEGORIZATION_RPM_LIMIT = parsePositiveInt(
	process.env.CATEGORIZATION_RPM_LIMIT,
	0,
);
const categorizationRpmLimiter =
	CATEGORIZATION_RPM_LIMIT > 0
		? createRpmLimiter(CATEGORIZATION_RPM_LIMIT)
		: null;

async function callModel(
	config: EnsembleModelConfig,
	messages: { systemMessage: string; userMessage: string },
): Promise<unknown> {
	const maxAttempts = (config.maxRetries ?? 0) + 1;
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			if (config.provider === "vertex-express") {
				const result = await callVertexExpressGenerateContent({
					config,
					systemMsg: messages.systemMessage,
					userMsg: messages.userMessage,
					responseMimeType: "application/json",
				});
				return extractJsonPayload(result.responseText);
			}

			if (!isOpenAiCompatibleProvider(config)) {
				throw new Error(
					`Unsupported categorization provider "${config.provider}" for model ${config.id}`,
				);
			}

			const apiKey = readApiKey(config);
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

			try {
				const headers: Record<string, string> = {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				};
				if (config.provider === "openrouter") {
					headers["HTTP-Referer"] =
						process.env.OPENROUTER_HTTP_REFERER ?? "https://kosarica.local";
					headers["X-Title"] =
						process.env.OPENROUTER_X_TITLE ?? "Kosarica Categorization";
				}

				const baseBody = {
					model: config.model,
					temperature: 0,
					max_tokens: config.maxTokens ?? 9000,
					messages: [
						{ role: "system", content: messages.systemMessage },
						{ role: "user", content: messages.userMessage },
					],
				};

				const tryRequest = async (
					withResponseFormat: boolean,
				): Promise<{
					ok: boolean;
					status: number;
					statusText: string;
					bodyText: string;
					headers: Record<string, string>;
				}> => {
					if (categorizationRpmLimiter) {
						await categorizationRpmLimiter.wait();
					}
					const response = await fetch(config.endpoint ?? "", {
						method: "POST",
						headers,
						body: JSON.stringify(
							withResponseFormat
								? {
										...baseBody,
										response_format: { type: "json_object" },
									}
								: baseBody,
						),
						signal: controller.signal,
					});
					const bodyText = await response.text();
					const rateLimitHeaders: Record<string, string> = {};
					const headerNames = [
						"retry-after",
						"x-ratelimit-limit",
						"x-ratelimit-remaining",
						"x-ratelimit-reset",
						"x-ratelimit-reset-requests",
						"x-ratelimit-reset-tokens",
						"x-request-id",
						"cf-ray",
					];
					for (const name of headerNames) {
						const value = response.headers.get(name);
						if (value) {
							rateLimitHeaders[name] = value;
						}
					}
					return {
						ok: response.ok,
						status: response.status,
						statusText: response.statusText,
						bodyText,
						headers: rateLimitHeaders,
					};
				};

				let result = await tryRequest(true);
				if (
					!result.ok &&
					isLikelyResponseFormatError(result.status, result.bodyText)
				) {
					result = await tryRequest(false);
				}

				if (!result.ok) {
					log.warn("Categorization LLM HTTP error", {
						provider: config.provider,
						model: config.model,
						attempt,
						status: result.status,
						statusText: result.statusText,
						bodySnippet: result.bodyText.slice(0, 280),
						rateLimitHeaders: result.headers,
					});
					throw new Error(
						`${config.provider}:${config.model} HTTP ${result.status} ${result.statusText} body=${result.bodyText.slice(0, 280)}`,
					);
				}

				const jsonBody = JSON.parse(result.bodyText) as unknown;
				const content = extractMessageContent(jsonBody);
				return extractJsonPayload(content);
			} finally {
				clearTimeout(timeout);
			}
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			const isAbort = error instanceof Error && error.name === "AbortError";
			log.warn("Categorization LLM call failed", {
				provider: config.provider,
				model: config.model,
				attempt,
				maxAttempts,
				errorType: isAbort ? "AbortError/timeout" : error?.constructor?.name,
				errorMessage: lastError.message.slice(0, 200),
			});
			if (attempt < maxAttempts) {
				await sleep(500 * attempt);
			}
		}
	}

	throw lastError ?? new Error(`Model call failed for ${config.id}`);
}

function toPromptItems(
	rows: readonly CategorizationInputRow[],
): CategorizationPromptItem[] {
	return rows.map((row) => ({
		itemId: row.itemId,
		name: row.name,
		brand: row.brand,
		category: row.category,
		subcategory: row.subcategory,
		unit: row.unit,
		unitQuantity: row.unitQuantity,
		chainSlug: row.chainSlug,
	}));
}

function normalizePackAmount(value: number | null, fallback: number): number {
	if (value == null || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.max(1, Math.round(value));
}

function toBaseUnitAmount(amount: number, unit: string): number {
	switch (unit) {
		case "g":
			return amount / 1000;
		case "kg":
			return amount;
		case "ml":
			return amount / 1000;
		case "l":
			return amount;
		case "kom":
			return amount;
		default:
			return amount;
	}
}

async function persistCategorization(
	db: DatabaseType,
	row: CategorizationInputRow,
	categorization: PersistedCategorization,
	categorizedAt: Date,
): Promise<void> {
	const [existingFeature] = await db
		.select({
			normalizedCategory: retailerItemFeatures.normalizedCategory,
			extractedAmount: retailerItemFeatures.extractedAmount,
			extractedUnit: retailerItemFeatures.extractedUnit,
			isCountItem: retailerItemFeatures.isCountItem,
			isMultipack: retailerItemFeatures.isMultipack,
			packAmount: retailerItemFeatures.packAmount,
			unitAmount: retailerItemFeatures.unitAmount,
			totalAmount: retailerItemFeatures.totalAmount,
			containerType: retailerItemFeatures.containerType,
			blockingKeys: retailerItemFeatures.blockingKeys,
		})
		.from(retailerItemFeatures)
		.where(eq(retailerItemFeatures.retailerItemId, row.itemId))
		.limit(1);

	const hasCategoryOverride = row.categoryOverrideBy != null;
	const hasUnitOverride = row.unitOverrideBy != null;

	const featureInput = parseRetailerItemFeature({
		retailerItemId: row.itemId,
		name: categorization.everydayName ?? row.name,
		brand: categorization.brand ?? row.brand,
		category: row.category,
		unit: row.unit,
		unitQuantity: row.unitQuantity,
	});

	const fallbackPackAmount =
		featureInput.packAmount > 0 ? featureInput.packAmount : 1;
	const packAmount = normalizePackAmount(
		categorization.packAmount,
		fallbackPackAmount,
	);
	const amount = categorization.extractedAmount;
	const unit = categorization.extractedUnit;
	const hasAmountData =
		amount != null &&
		Number.isFinite(amount) &&
		amount > 0 &&
		(unit === "g" ||
			unit === "kg" ||
			unit === "ml" ||
			unit === "l" ||
			unit === "kom");

	const unitAmount = hasAmountData
		? toBaseUnitAmount(amount as number, unit as string)
		: featureInput.unitAmount;
	const totalAmount =
		hasAmountData && unitAmount != null
			? unitAmount * packAmount
			: featureInput.totalAmount;
	const isCountItem = hasAmountData ? unit === "kom" : featureInput.isCountItem;
	const extractedAmount = hasAmountData ? amount : featureInput.extractedAmount;
	const extractedUnit = hasAmountData ? unit : featureInput.extractedUnit;
	const normalizedCategory = hasCategoryOverride
		? (existingFeature?.normalizedCategory ?? featureInput.normalizedCategory)
		: featureInput.normalizedCategory;
	const finalExtractedAmount = hasUnitOverride
		? (existingFeature?.extractedAmount ?? extractedAmount)
		: extractedAmount;
	const finalExtractedUnit = hasUnitOverride
		? (existingFeature?.extractedUnit ?? extractedUnit)
		: extractedUnit;
	const finalIsCountItem = hasUnitOverride
		? (existingFeature?.isCountItem ?? isCountItem)
		: isCountItem;
	const finalIsMultipack = hasUnitOverride
		? (existingFeature?.isMultipack ?? packAmount > 1)
		: packAmount > 1;
	const finalPackAmount = hasUnitOverride
		? (existingFeature?.packAmount ?? packAmount)
		: packAmount;
	const finalUnitAmount = hasUnitOverride
		? (existingFeature?.unitAmount ?? unitAmount)
		: unitAmount;
	const finalTotalAmount = hasUnitOverride
		? (existingFeature?.totalAmount ?? totalAmount)
		: totalAmount;
	const finalContainerType = hasUnitOverride
		? (existingFeature?.containerType ??
			categorization.containerType ??
			featureInput.containerType)
		: (categorization.containerType ?? featureInput.containerType);
	const finalBlockingKeys =
		(hasCategoryOverride || hasUnitOverride) && existingFeature?.blockingKeys
			? existingFeature.blockingKeys
			: featureInput.blockingKeys;

	await db
		.insert(retailerItemFeatures)
		.values({
			id: generatePrefixedId("rif"),
			retailerItemId: row.itemId,
			normalizedName: featureInput.normalizedName,
			normalizedCategory,
			extractedBrand: categorization.brand ?? featureInput.extractedBrand,
			extractedAmount: finalExtractedAmount,
			extractedUnit: finalExtractedUnit,
			isCountItem: finalIsCountItem,
			isMultipack: finalIsMultipack,
			packAmount: finalPackAmount,
			unitAmount: finalUnitAmount,
			totalAmount: finalTotalAmount,
			containerType: finalContainerType,
			blockingKeys: finalBlockingKeys,
			everydayName: categorization.everydayName,
			productType: categorization.productType,
			variant: categorization.variant,
			searchTags: categorization.searchTags,
			categorizedAt,
			categorizationModel: categorization.modelId,
			categorizationConfidence: categorization.confidence,
			categorizationNeedsReview: categorization.needsReview,
		})
		.onConflictDoUpdate({
			target: [retailerItemFeatures.retailerItemId],
			set: {
				normalizedName: featureInput.normalizedName,
				normalizedCategory,
				extractedBrand: categorization.brand ?? featureInput.extractedBrand,
				extractedAmount: finalExtractedAmount,
				extractedUnit: finalExtractedUnit,
				isCountItem: finalIsCountItem,
				isMultipack: finalIsMultipack,
				packAmount: finalPackAmount,
				unitAmount: finalUnitAmount,
				totalAmount: finalTotalAmount,
				containerType: finalContainerType,
				blockingKeys: finalBlockingKeys,
				everydayName: categorization.everydayName,
				productType: categorization.productType,
				variant: categorization.variant,
				searchTags: categorization.searchTags,
				categorizedAt,
				categorizationModel: categorization.modelId,
				categorizationConfidence: categorization.confidence,
				categorizationNeedsReview: categorization.needsReview,
			},
		});
}

async function fetchCategorizationInputRows(
	db: DatabaseType,
	itemIds: readonly string[],
): Promise<CategorizationInputRow[]> {
	if (itemIds.length === 0) {
		return [];
	}

	return await db
		.select({
			itemId: retailerItems.id,
			name: retailerItems.name,
			brand: retailerItems.brand,
			category: retailerItems.category,
			subcategory: retailerItems.subcategory,
			unit: retailerItems.unit,
			unitQuantity: retailerItems.unitQuantity,
			chainSlug: retailerItems.chainSlug,
			categoryOverrideBy: retailerItems.categoryOverrideBy,
			unitOverrideBy: retailerItems.unitOverrideBy,
		})
		.from(retailerItems)
		.where(
			and(
				inArray(retailerItems.id, Array.from(itemIds)),
				isNull(retailerItems.mergedIntoId),
			),
		);
}

async function categorizeChunk(
	rows: readonly CategorizationInputRow[],
	models: {
		primaryModel: EnsembleModelConfig;
		secondaryModel: EnsembleModelConfig | null;
	},
	confidenceThreshold: number,
): Promise<{
	accepted: Map<string, PersistedCategorization>;
	failedItemIds: Set<string>;
	escalatedCount: number;
}> {
	// Short IDs are intentional: models often fail to copy long DB IDs verbatim,
	// which then causes strict schema parsing to drop results.
	const llmIdByRealId = new Map<string, string>();
	for (const [index, row] of rows.entries()) {
		// Avoid numeric-only IDs because models sometimes emit them as JSON numbers.
		llmIdByRealId.set(row.itemId, `i${index + 1}`);
	}

	const llmExpectedIds = new Set<string>(Array.from(llmIdByRealId.values()));
	const primaryPromptItems = toPromptItems(rows).map((item) => ({
		...item,
		itemId: llmIdByRealId.get(item.itemId) ?? item.itemId,
	}));

	const primaryMessages = await buildCategorizationMessages(primaryPromptItems);
	const primaryStartedAt = Date.now();
	let primaryPayload: unknown;
	try {
		primaryPayload = await callModel(models.primaryModel, primaryMessages);
		const primaryLatencyMs = Date.now() - primaryStartedAt;
		await recordEndpointResult(models.primaryModel.id, {
			success: true,
			latencyMs: primaryLatencyMs,
		});
	} catch (error) {
		await recordEndpointResult(models.primaryModel.id, {
			success: false,
			latencyMs: Date.now() - primaryStartedAt,
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
	const primaryLatencyMs = Date.now() - primaryStartedAt;
	const primaryParsedByLlmId = parseCategorizationResponse(
		primaryPayload,
		llmExpectedIds,
	);
	const primaryParsed = new Map<string, ParsedCategorization>();
	for (const row of rows) {
		const llmId = llmIdByRealId.get(row.itemId);
		if (!llmId) continue;
		const parsed = primaryParsedByLlmId.get(llmId);
		if (!parsed) continue;
		primaryParsed.set(row.itemId, { ...parsed, itemId: row.itemId });
	}
	await tryLogCategorizationDecision({
		model: models.primaryModel,
		itemIds: rows.map((row) => row.itemId),
		rawOutput: primaryPayload,
		parsed: primaryParsed,
		latencyMs: primaryLatencyMs,
		stage: "primary",
	});

	const accepted = new Map<string, PersistedCategorization>();
	const failedItemIds = new Set<string>();
	let escalatedCount = 0;

	const lowConfidenceRows: CategorizationInputRow[] = [];
	for (const row of rows) {
		const parsed = primaryParsed.get(row.itemId);
		if (!parsed) {
			failedItemIds.add(row.itemId);
			continue;
		}
		if (parsed.confidence >= confidenceThreshold) {
			accepted.set(row.itemId, {
				itemId: row.itemId,
				everydayName: parsed.everydayName,
				productType: parsed.productType,
				brand: parsed.brand,
				variant: parsed.variant,
				searchTags: parsed.searchTags,
				extractedAmount: parsed.extractedAmount,
				extractedUnit: parsed.extractedUnit,
				packAmount: parsed.packAmount,
				containerType: parsed.containerType,
				confidence: parsed.confidence,
				modelId: models.primaryModel.model,
				needsReview: false,
			});
		} else {
			lowConfidenceRows.push(row);
		}
	}

	if (lowConfidenceRows.length === 0) {
		return { accepted, failedItemIds, escalatedCount };
	}

	escalatedCount += lowConfidenceRows.length;

	if (!models.secondaryModel) {
		for (const row of lowConfidenceRows) {
			const primary = primaryParsed.get(row.itemId);
			if (!primary) {
				failedItemIds.add(row.itemId);
				continue;
			}
			accepted.set(row.itemId, {
				itemId: row.itemId,
				everydayName: primary.everydayName,
				productType: primary.productType,
				brand: primary.brand,
				variant: primary.variant,
				searchTags: primary.searchTags,
				extractedAmount: primary.extractedAmount,
				extractedUnit: primary.extractedUnit,
				packAmount: primary.packAmount,
				containerType: primary.containerType,
				confidence: primary.confidence,
				modelId: models.primaryModel.model,
				needsReview: true,
			});
		}
		return { accepted, failedItemIds, escalatedCount };
	}

	try {
		const secondaryPromptItems = toPromptItems(lowConfidenceRows).map(
			(item) => ({
				...item,
				itemId: llmIdByRealId.get(item.itemId) ?? item.itemId,
			}),
		);
		const secondaryMessages =
			await buildCategorizationMessages(secondaryPromptItems);
		const secondaryStartedAt = Date.now();
		let secondaryPayload: unknown;
		try {
			secondaryPayload = await callModel(models.secondaryModel, secondaryMessages);
			await recordEndpointResult(models.secondaryModel.id, {
				success: true,
				latencyMs: Date.now() - secondaryStartedAt,
			});
		} catch (error) {
			await recordEndpointResult(models.secondaryModel.id, {
				success: false,
				latencyMs: Date.now() - secondaryStartedAt,
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
		const secondaryLatencyMs = Date.now() - secondaryStartedAt;
		const secondaryParsedByLlmId = parseCategorizationResponse(
			secondaryPayload,
			new Set(
				lowConfidenceRows
					.map((row) => llmIdByRealId.get(row.itemId))
					.filter(
						(id): id is string => typeof id === "string" && id.length > 0,
					),
			),
		);
		const secondaryParsed = new Map<string, ParsedCategorization>();
		for (const row of lowConfidenceRows) {
			const llmId = llmIdByRealId.get(row.itemId);
			if (!llmId) continue;
			const parsed = secondaryParsedByLlmId.get(llmId);
			if (!parsed) continue;
			secondaryParsed.set(row.itemId, { ...parsed, itemId: row.itemId });
		}
		await tryLogCategorizationDecision({
			model: models.secondaryModel,
			itemIds: lowConfidenceRows.map((row) => row.itemId),
			rawOutput: secondaryPayload,
			parsed: secondaryParsed,
			latencyMs: secondaryLatencyMs,
			stage: "secondary",
		});

		for (const row of lowConfidenceRows) {
			const primary = primaryParsed.get(row.itemId);
			const secondary = secondaryParsed.get(row.itemId);
			if (!primary) {
				failedItemIds.add(row.itemId);
				continue;
			}
			const agreed = secondary
				? categorizationsAgree(primary, secondary)
				: false;
			accepted.set(row.itemId, {
				itemId: row.itemId,
				everydayName: primary.everydayName,
				productType: primary.productType,
				brand: primary.brand,
				variant: primary.variant,
				searchTags: primary.searchTags,
				extractedAmount: primary.extractedAmount,
				extractedUnit: primary.extractedUnit,
				packAmount: primary.packAmount,
				containerType: primary.containerType,
				confidence: primary.confidence,
				modelId: agreed
					? models.primaryModel.model
					: `${models.primaryModel.model}+${models.secondaryModel.model}`,
				needsReview: !agreed,
			});
		}
	} catch (error) {
		log.warn(
			"Secondary categorization model failed, marking escalations for review",
			{
				error,
				itemCount: lowConfidenceRows.length,
				model: models.secondaryModel.model,
			},
		);
		for (const row of lowConfidenceRows) {
			const primary = primaryParsed.get(row.itemId);
			if (!primary) {
				failedItemIds.add(row.itemId);
				continue;
			}
			accepted.set(row.itemId, {
				itemId: row.itemId,
				everydayName: primary.everydayName,
				productType: primary.productType,
				brand: primary.brand,
				variant: primary.variant,
				searchTags: primary.searchTags,
				extractedAmount: primary.extractedAmount,
				extractedUnit: primary.extractedUnit,
				packAmount: primary.packAmount,
				containerType: primary.containerType,
				confidence: primary.confidence,
				modelId: models.primaryModel.model,
				needsReview: true,
			});
		}
	}

	return { accepted, failedItemIds, escalatedCount };
}

export async function categorizeBatch(
	itemIds: string[],
): Promise<CategorizationBatchResult> {
	const dedupedIds = Array.from(new Set(itemIds.filter((id) => id.length > 0)));
	if (dedupedIds.length === 0) {
		return { succeeded: 0, failed: 0, escalated: 0 };
	}

	const db = getDb();
	const rows = await fetchCategorizationInputRows(db, dedupedIds);
	if (rows.length === 0) {
		return { succeeded: 0, failed: dedupedIds.length, escalated: 0 };
	}

	const models = await getCategorizationModels();
	const batchSize = parsePositiveInt(
		process.env.CATEGORIZATION_BATCH_SIZE,
		DEFAULT_BATCH_SIZE,
	);
	const confidenceThreshold = parseConfidenceThreshold(
		process.env.CATEGORIZATION_CONFIDENCE_THRESHOLD,
	);

	const rowBatches = chunk(rows, batchSize);
	let succeeded = 0;
	let failed = dedupedIds.length - rows.length;
	let escalated = 0;

	for (const [batchIndex, rowBatch] of rowBatches.entries()) {
		try {
			const result = await categorizeChunk(
				rowBatch,
				models,
				confidenceThreshold,
			);
			const categorizedAt = new Date();
			for (const row of rowBatch) {
				const parsed = result.accepted.get(row.itemId);
				if (!parsed) {
					continue;
				}
				await persistCategorization(db, row, parsed, categorizedAt);
			}
			succeeded += result.accepted.size;
			failed += result.failedItemIds.size;
			escalated += result.escalatedCount;

			log.info("Categorized batch", {
				batchIndex: batchIndex + 1,
				batchesTotal: rowBatches.length,
				itemsInBatch: rowBatch.length,
				succeeded: result.accepted.size,
				failed: result.failedItemIds.size,
				escalated: result.escalatedCount,
			});
		} catch (error) {
			failed += rowBatch.length;
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			log.error("Categorization batch failed", {
				error: errorToObject(error),
				errorMessage,
				batchIndex: batchIndex + 1,
				batchesTotal: rowBatches.length,
				itemsInBatch: rowBatch.length,
			});
		}
	}

	return { succeeded, failed, escalated };
}

export async function categorizeRunItems(
	runId: string,
	chainSlug: string,
): Promise<CategorizationBatchResult> {
	const db = getDb();
	const [run] = await db
		.select({
			id: ingestionRuns.id,
			archiveId: ingestionRuns.archiveId,
		})
		.from(ingestionRuns)
		.where(eq(ingestionRuns.id, runId))
		.limit(1);

	if (!run || !run.archiveId) {
		return { succeeded: 0, failed: 0, escalated: 0 };
	}

	const itemRows = await db
		.select({
			itemId: retailerItems.id,
		})
		.from(retailerItems)
		.leftJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.where(
			and(
				eq(retailerItems.chainSlug, chainSlug),
				eq(retailerItems.archiveId, run.archiveId),
				isNull(retailerItems.mergedIntoId),
				or(
					isNull(retailerItemFeatures.retailerItemId),
					isNull(retailerItemFeatures.categorizedAt),
				),
			),
		);

	return categorizeBatch(itemRows.map((row) => row.itemId));
}

export async function countUncategorizedItems(): Promise<number> {
	const db = getDb();
	const result = await db.execute(sql`
		SELECT count(*)::int AS count
		FROM retailer_items ri
		LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ri.merged_into_id IS NULL
			AND (rif.retailer_item_id IS NULL OR rif.categorized_at IS NULL)
	`);
	const row = Array.isArray(result)
		? (result[0] as { count?: number } | undefined)
		: ((result as { rows?: Array<{ count?: number }> }).rows?.[0] ?? undefined);
	return Number(row?.count ?? 0);
}

export async function backfillUncategorizedItems(options?: {
	batchSize?: number;
	maxBatches?: number;
	chainSlug?: string;
	maxRuntimeMinutes?: number;
}): Promise<CategorizationBatchResult & { batchesProcessed: number }> {
	const db = getDb();
	const defaultBatchSize = parsePositiveInt(
		process.env.CATEGORIZATION_BATCH_SIZE,
		DEFAULT_BATCH_SIZE,
	);
	const batchSize = options?.batchSize ?? defaultBatchSize;
	const backfillConcurrency = parsePositiveInt(
		process.env.CATEGORIZATION_BACKFILL_CONCURRENCY,
		1,
	);
	const maxBatches = options?.maxBatches ?? 200;
	let batchesProcessed = 0;
	let succeeded = 0;
	let failed = 0;
	let escalated = 0;
	let consecutiveWaveFailures = 0;
	const maxConsecutiveWaveFailures = parsePositiveInt(
		process.env.CATEGORIZATION_MAX_CONSECUTIVE_WAVE_FAILURES,
		5,
	);
	const maxRuntimeMs =
		options?.maxRuntimeMinutes && options.maxRuntimeMinutes > 0
			? options.maxRuntimeMinutes * 60_000
			: null;
	const startedAtMs = Date.now();

	for (let i = 0; i < maxBatches; ) {
		if (maxRuntimeMs != null && Date.now() - startedAtMs >= maxRuntimeMs) {
			log.info("Stopping categorization backfill due to runtime limit", {
				batchesProcessed,
				maxRuntimeMinutes: options?.maxRuntimeMinutes,
			});
			break;
		}

		const remaining = maxBatches - i;
		const planned = Math.max(1, Math.min(backfillConcurrency, remaining));

		const conditions = [
			isNull(retailerItems.mergedIntoId),
			or(
				isNull(retailerItemFeatures.retailerItemId),
				isNull(retailerItemFeatures.categorizedAt),
			),
		];
		if (options?.chainSlug) {
			conditions.push(eq(retailerItems.chainSlug, options.chainSlug));
		}

		const rows = await db
			.select({ itemId: retailerItems.id })
			.from(retailerItems)
			.leftJoin(
				retailerItemFeatures,
				eq(retailerItemFeatures.retailerItemId, retailerItems.id),
			)
			.where(and(...conditions))
			.orderBy(retailerItems.createdAt)
			.limit(batchSize * planned);

		if (rows.length === 0) {
			break;
		}

		const groups = chunk(rows, batchSize).slice(0, planned);
		const settled = await Promise.allSettled(
			groups.map((group) => categorizeBatch(group.map((row) => row.itemId))),
		);

		let waveSucceeded = 0;
		let waveFailed = 0;
		let waveEscalated = 0;

		for (const [groupIndex, result] of settled.entries()) {
			const groupSize = groups[groupIndex]?.length ?? 0;
			if (result.status === "fulfilled") {
				waveSucceeded += result.value.succeeded;
				waveFailed += result.value.failed;
				waveEscalated += result.value.escalated;
			} else {
				waveFailed += groupSize;
				log.error("Categorization backfill batch failed", {
					error: errorToObject(result.reason),
					groupIndex: groupIndex + 1,
					groupCount: groups.length,
					itemsInGroup: groupSize,
				});
			}
		}

		batchesProcessed += groups.length;
		i += groups.length;
		succeeded += waveSucceeded;
		failed += waveFailed;
		escalated += waveEscalated;

		if (waveSucceeded === 0 && waveFailed > 0) {
			consecutiveWaveFailures += 1;
			log.warn("Categorization backfill wave failed", {
				batchIndex: batchesProcessed,
				failed: waveFailed,
				concurrency: planned,
				consecutiveWaveFailures,
				maxConsecutiveWaveFailures,
			});

			if (consecutiveWaveFailures >= maxConsecutiveWaveFailures) {
				log.warn(
					"Stopping categorization backfill after repeated full-wave failures",
					{
						batchIndex: batchesProcessed,
						failed: waveFailed,
						consecutiveWaveFailures,
						maxConsecutiveWaveFailures,
					},
				);
				break;
			}

			// Allow transient provider failures (429/timeout) to recover.
			await sleep(Math.min(30_000, 2_000 * consecutiveWaveFailures));
			continue;
		}

		consecutiveWaveFailures = 0;
	}

	return { batchesProcessed, succeeded, failed, escalated };
}
