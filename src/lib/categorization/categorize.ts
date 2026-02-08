import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
	ingestionRuns,
	retailerItemFeatures,
	retailerItems,
	type DatabaseType,
} from "@/db";
import {
	parseEnsembleConfig,
	readApiKey,
	type EnsembleModelConfig,
} from "@/lib/semantic-clustering/config";
import { chunk } from "@/lib/collections/chunk";
import { logLlmDecision } from "@/lib/llm-observability";
import { extractJsonPayload } from "@/lib/semantic-clustering/llm";
import { parseRetailerItemFeature } from "@/lib/semantic-clustering/normalize";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger, errorToObject } from "@/utils/logger";
import { categorizationsAgree, parseCategorizationResponse } from "./parse";
import {
	buildCategorizationMessages,
	type CategorizationPromptItem,
} from "./prompt";

const log = createLogger("matching");

const DEFAULT_CATEGORIZATION_ENSEMBLE_JSON = JSON.stringify([
	{
		id: "deepseek-primary",
		provider: "openrouter",
		model: "deepseek/deepseek-v3.2",
		apiKeyEnv: "OPENROUTER_API_KEY",
		timeoutMs: 180000,
		maxRetries: 1,
	},
	{
		id: "gpt-oss-secondary",
		provider: "openrouter",
		model: "openai/gpt-oss-20b",
		apiKeyEnv: "OPENROUTER_API_KEY",
		timeoutMs: 180000,
		maxRetries: 1,
	},
]);

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

function getCategorizationModels(): {
	primaryModel: EnsembleModelConfig;
	secondaryModel: EnsembleModelConfig | null;
} {
	const raw =
		process.env.CATEGORIZATION_ENSEMBLE_JSON ??
		DEFAULT_CATEGORIZATION_ENSEMBLE_JSON;
	const parsed = parseEnsembleConfig(raw);
	if (parsed.length === 0) {
		throw new Error("No categorization models configured");
	}
	return {
		primaryModel: parsed[0],
		secondaryModel: parsed[1] ?? null,
	};
}

function isOpenAiCompatibleProvider(config: EnsembleModelConfig): boolean {
	return config.provider === "openrouter" || config.provider === "openai";
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

async function callModel(
	config: EnsembleModelConfig,
	messages: { systemMessage: string; userMessage: string },
): Promise<unknown> {
	if (!isOpenAiCompatibleProvider(config)) {
		throw new Error(
			`Unsupported categorization provider "${config.provider}" for model ${config.id}`,
		);
	}

	const apiKey = readApiKey(config);
	const maxAttempts = (config.maxRetries ?? 0) + 1;
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

		try {
			const response = await fetch(config.endpoint ?? "", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					"HTTP-Referer": "https://kosarica.local",
					"X-Title": "Kosarica Categorization",
				},
				body: JSON.stringify({
					model: config.model,
					temperature: 0,
					max_tokens: 9000,
					response_format: { type: "json_object" },
					messages: [
						{ role: "system", content: messages.systemMessage },
						{ role: "user", content: messages.userMessage },
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

			const jsonBody = await response.json();
			const content = extractMessageContent(jsonBody);
			return extractJsonPayload(content);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < maxAttempts) {
				await sleep(500 * attempt);
			}
		} finally {
			clearTimeout(timeout);
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

	const fallbackPackAmount = featureInput.packAmount > 0 ? featureInput.packAmount : 1;
	const packAmount = normalizePackAmount(categorization.packAmount, fallbackPackAmount);
	const amount = categorization.extractedAmount;
	const unit = categorization.extractedUnit;
	const hasAmountData =
		amount != null &&
		Number.isFinite(amount) &&
		amount > 0 &&
		(unit === "g" || unit === "kg" || unit === "ml" || unit === "l" || unit === "kom");

	const unitAmount = hasAmountData
		? toBaseUnitAmount(amount as number, unit as string)
		: featureInput.unitAmount;
	const totalAmount =
		hasAmountData && unitAmount != null
			? unitAmount * packAmount
			: featureInput.totalAmount;
	const isCountItem = hasAmountData
		? unit === "kom"
		: featureInput.isCountItem;
	const extractedAmount = hasAmountData
		? amount
		: featureInput.extractedAmount;
	const extractedUnit = hasAmountData
		? unit
		: featureInput.extractedUnit;
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
		? (existingFeature?.containerType ?? categorization.containerType ?? featureInput.containerType)
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
	const itemIds = new Set(rows.map((row) => row.itemId));
	const primaryMessages = await buildCategorizationMessages(toPromptItems(rows));
	const primaryStartedAt = Date.now();
	const primaryPayload = await callModel(models.primaryModel, primaryMessages);
	const primaryLatencyMs = Date.now() - primaryStartedAt;
	const primaryParsed = parseCategorizationResponse(primaryPayload, itemIds);
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
		const secondaryMessages = await buildCategorizationMessages(
			toPromptItems(lowConfidenceRows),
		);
		const secondaryStartedAt = Date.now();
		const secondaryPayload = await callModel(
			models.secondaryModel,
			secondaryMessages,
		);
		const secondaryLatencyMs = Date.now() - secondaryStartedAt;
		const secondaryParsed = parseCategorizationResponse(
			secondaryPayload,
			new Set(lowConfidenceRows.map((row) => row.itemId)),
		);
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
		log.warn("Secondary categorization model failed, marking escalations for review", {
			error,
			itemCount: lowConfidenceRows.length,
			model: models.secondaryModel.model,
		});
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

	const models = getCategorizationModels();
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
			const result = await categorizeChunk(rowBatch, models, confidenceThreshold);
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
}): Promise<CategorizationBatchResult & { batchesProcessed: number }> {
	const db = getDb();
	const batchSize = options?.batchSize ?? 1000;
	const maxBatches = options?.maxBatches ?? 200;
	let batchesProcessed = 0;
	let succeeded = 0;
	let failed = 0;
	let escalated = 0;

	for (let i = 0; i < maxBatches; i += 1) {
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
			.limit(batchSize);

		if (rows.length === 0) {
			break;
		}

		const result = await categorizeBatch(rows.map((row) => row.itemId));
		batchesProcessed += 1;
		succeeded += result.succeeded;
		failed += result.failed;
		escalated += result.escalated;

		if (result.succeeded === 0 && result.failed > 0) {
			log.warn("Stopping categorization backfill early due to full batch failure", {
				batchIndex: batchesProcessed,
				failed: result.failed,
			});
			break;
		}
	}

	return { batchesProcessed, succeeded, failed, escalated };
}
