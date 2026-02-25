import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { type DatabaseType, retailerItemFeatures, retailerItems } from "@/db";
import { logLlmDecision } from "@/lib/llm-observability";
import { getDiverseEndpoints } from "@/lib/llm-routing";
import { extractJsonPayload } from "@/lib/semantic-clustering/llm";
import { getDb } from "@/utils/bindings";
import { createLogger, errorToObject } from "@/utils/logger";
import {
	type ParsedCategorization,
	parseCategorizationResponse,
} from "./parse";
import {
	buildCategorizationMessages,
	type CategorizationPromptItem,
} from "./prompt";

const log = createLogger("matching");

export interface ReverificationVote {
	modelId: string;
	provider: string;
	endpointId: string;
	confidence: number;
	everydayName: string | null;
	productType: string | null;
	brand: string | null;
	variant: string | null;
	searchTags: string[];
	extractedAmount: number | null;
	extractedUnit: string | null;
	packAmount: number | null;
	containerType: string | null;
	latencyMs: number;
}

export interface ReverificationResult {
	itemId: string;
	originalName: string;
	originalConfidence: number;
	votes: ReverificationVote[];
	consensusReached: boolean;
	consensusType: "unanimous" | "majority" | "none";
	agreementRatio: number;
	finalCategorization: ParsedCategorization | null;
	needsHumanReview: boolean;
}

export interface ReverificationOptions {
	modelCount?: number;
	confidenceThreshold?: number;
	requireUnanimousForZeroConfidence?: boolean;
}

const DEFAULT_OPTIONS: Required<ReverificationOptions> = {
	modelCount: 3,
	confidenceThreshold: 0.8,
	requireUnanimousForZeroConfidence: true,
};

async function callSingleModel(
	config: {
		id: string;
		provider: string;
		model: string;
		endpoint: string;
		timeoutMs: number;
		maxTokens?: number;
		maxRetries?: number;
		apiKeyEnv?: string;
	},
	messages: { systemMessage: string; userMessage: string },
): Promise<{ payload: unknown; latencyMs: number }> {
	const apiKeyEnv =
		config.apiKeyEnv ??
		(config.provider === "openai"
			? "OPENAI_API_KEY"
			: config.provider === "openrouter"
				? "OPENROUTER_API_KEY"
				: config.provider === "nvidia-nim"
					? "NIM_API_KEY"
					: config.provider === "zai"
						? "ZAI_API_KEY"
						: "");
	const apiKey = apiKeyEnv ? (process.env[apiKeyEnv] ?? "") : "";

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
			process.env.OPENROUTER_X_TITLE ?? "Kosarica Categorization";
	}

	const body = {
		model: config.model,
		temperature: 0,
		max_tokens: config.maxTokens ?? 9000,
		messages: [
			{ role: "system", content: messages.systemMessage },
			{ role: "user", content: messages.userMessage },
		],
	};

	const startedAt = Date.now();
	const controller = new AbortController();
	const timeoutMs = config.timeoutMs ?? 120_000;
	const timeout = setTimeout(() => {
		controller.abort();
	}, timeoutMs);

	try {
		const response = await fetch(config.endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		const bodyText = await response.text();
		if (!response.ok) {
			throw new Error(
				`${config.provider}:${config.model} HTTP ${response.status} ${response.statusText}`,
			);
		}

		const jsonBody = JSON.parse(bodyText) as unknown;
		const content =
			(jsonBody as { choices?: Array<{ message?: { content?: string } }> })
				?.choices?.[0]?.message?.content ?? "";
		const payload = extractJsonPayload(content);

		return { payload, latencyMs: Date.now() - startedAt };
	} finally {
		clearTimeout(timeout);
	}
}

function normalizeProductType(value: string | null): string {
	if (!value) return "";
	return value.toLowerCase().trim();
}

function computeAgreement(votes: ReverificationVote[]): {
	consensusType: "unanimous" | "majority" | "none";
	agreementRatio: number;
	winner: ReverificationVote | null;
} {
	if (votes.length === 0) {
		return { consensusType: "none", agreementRatio: 0, winner: null };
	}

	if (votes.length === 1) {
		return {
			consensusType: "unanimous",
			agreementRatio: 1,
			winner: votes[0],
		};
	}

	const byProductType = new Map<string, ReverificationVote[]>();
	for (const vote of votes) {
		const key = normalizeProductType(vote.productType);
		const existing = byProductType.get(key) ?? [];
		existing.push(vote);
		byProductType.set(key, existing);
	}

	let largestGroup: ReverificationVote[] = [];
	for (const group of byProductType.values()) {
		if (group.length > largestGroup.length) {
			largestGroup = group;
		}
	}

	const agreementRatio = largestGroup.length / votes.length;

	if (agreementRatio === 1) {
		const highestConfidence = largestGroup.reduce((best, vote) =>
			vote.confidence > best.confidence ? vote : best,
		);
		return {
			consensusType: "unanimous",
			agreementRatio: 1,
			winner: highestConfidence,
		};
	}

	if (agreementRatio >= 0.5) {
		const highestConfidence = largestGroup.reduce((best, vote) =>
			vote.confidence > best.confidence ? vote : best,
		);
		return {
			consensusType: "majority",
			agreementRatio,
			winner: highestConfidence,
		};
	}

	return { consensusType: "none", agreementRatio, winner: null };
}

function voteToParsedCategorization(
	vote: ReverificationVote,
): ParsedCategorization {
	return {
		itemId: "",
		everydayName: vote.everydayName,
		productType: vote.productType,
		brand: vote.brand,
		variant: vote.variant,
		searchTags: vote.searchTags,
		extractedAmount: vote.extractedAmount,
		extractedUnit: vote.extractedUnit,
		packAmount: vote.packAmount,
		containerType: vote.containerType,
		confidence: vote.confidence,
	};
}

async function fetchItemsForReverification(
	db: DatabaseType,
	options: { itemIds?: string[]; maxItems?: number; confidenceBelow?: number },
): Promise<
	Array<{
		itemId: string;
		originalName: string;
		originalConfidence: number | null;
		brand: string | null;
		category: string | null;
		subcategory: string | null;
		unit: string | null;
		unitQuantity: string | null;
		chainSlug: string | null;
	}>
> {
	const conditions = [
		sql`ri.merged_into_id IS NULL`,
		sql`rif.categorization_needs_review = true`,
	];

	if (options.confidenceBelow != null) {
		conditions.push(
			sql`rif.categorization_confidence < ${options.confidenceBelow}`,
		);
	}

	const query = db
		.select({
			itemId: retailerItems.id,
			originalName: retailerItems.name,
			originalConfidence: retailerItemFeatures.categorizationConfidence,
			brand: retailerItems.brand,
			category: retailerItems.category,
			subcategory: retailerItems.subcategory,
			unit: retailerItems.unit,
			unitQuantity: retailerItems.unitQuantity,
			chainSlug: retailerItems.chainSlug,
		})
		.from(retailerItems)
		.innerJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.where(and(...conditions))
		.orderBy(retailerItemFeatures.categorizationConfidence)
		.limit(options.maxItems ?? 100);

	if (options.itemIds && options.itemIds.length > 0) {
		return db
			.select({
				itemId: retailerItems.id,
				originalName: retailerItems.name,
				originalConfidence: retailerItemFeatures.categorizationConfidence,
				brand: retailerItems.brand,
				category: retailerItems.category,
				subcategory: retailerItems.subcategory,
				unit: retailerItems.unit,
				unitQuantity: retailerItems.unitQuantity,
				chainSlug: retailerItems.chainSlug,
			})
			.from(retailerItems)
			.innerJoin(
				retailerItemFeatures,
				eq(retailerItemFeatures.retailerItemId, retailerItems.id),
			)
			.where(
				and(
					inArray(retailerItems.id, options.itemIds),
					isNull(retailerItems.mergedIntoId),
				),
			);
	}

	return query;
}

async function updateCategorizationFromReverification(
	db: DatabaseType,
	itemId: string,
	result: ReverificationResult,
): Promise<void> {
	if (!result.finalCategorization) {
		await db
			.update(retailerItemFeatures)
			.set({
				categorizationNeedsReview: true,
			})
			.where(eq(retailerItemFeatures.retailerItemId, itemId));
		return;
	}

	const cat = result.finalCategorization;
	await db
		.update(retailerItemFeatures)
		.set({
			everydayName: cat.everydayName,
			productType: cat.productType,
			extractedBrand: cat.brand,
			variant: cat.variant,
			searchTags: cat.searchTags,
			extractedAmount: cat.extractedAmount,
			extractedUnit: cat.extractedUnit,
			packAmount: cat.packAmount ?? 1,
			containerType: cat.containerType,
			categorizationConfidence: cat.confidence,
			categorizationModel: `consensus:${result.votes.length}:${result.consensusType}`,
			categorizationNeedsReview: result.needsHumanReview,
			categorizedAt: new Date(),
		})
		.where(eq(retailerItemFeatures.retailerItemId, itemId));
}

async function logReverificationDecision(
	itemId: string,
	result: ReverificationResult,
): Promise<void> {
	try {
		await logLlmDecision({
			taskType: "categorize_reverification",
			input: {
				itemId,
				originalConfidence: result.originalConfidence,
				voteCount: result.votes.length,
			},
			output: {
				consensusType: result.consensusType,
				agreementRatio: result.agreementRatio,
				finalConfidence: result.finalCategorization?.confidence ?? null,
				votes: result.votes.map((v) => ({
					model: v.modelId,
					confidence: v.confidence,
					productType: v.productType,
				})),
			},
			modelId: "consensus",
			provider: "ensemble",
			verdict: result.consensusReached ? "consensus" : "no_consensus",
			confidence: result.finalCategorization?.confidence ?? 0,
			reasoning: result.needsHumanReview
				? "Scheduled for human review"
				: "Consensus reached",
		});
	} catch (error) {
		log.warn("Failed to log reverification decision", {
			error: errorToObject(error),
			itemId,
		});
	}
}

export async function reverifyItems(
	inputItemIds?: string[],
	options?: ReverificationOptions,
): Promise<{
	results: ReverificationResult[];
	totalProcessed: number;
	consensusReached: number;
	needsHumanReview: number;
}> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const db = getDb();

	const items = await fetchItemsForReverification(db, {
		itemIds: inputItemIds,
		maxItems: 100,
		confidenceBelow: opts.confidenceThreshold,
	});

	if (items.length === 0) {
		log.info("No items found for reverification");
		return {
			results: [],
			totalProcessed: 0,
			consensusReached: 0,
			needsHumanReview: 0,
		};
	}

	log.info("Starting reverification", {
		itemCount: items.length,
		modelCount: opts.modelCount,
	});

	const endpoints = await getDiverseEndpoints(
		"categorization_primary",
		opts.modelCount,
	);

	if (endpoints.length < 2) {
		log.warn("Not enough diverse endpoints for reverification", {
			endpointCount: endpoints.length,
		});
	}

	const results: ReverificationResult[] = [];

	for (const item of items) {
		const llmId = "i1";
		const promptItem: CategorizationPromptItem = {
			itemId: llmId,
			name: item.originalName,
			brand: item.brand,
			category: item.category,
			subcategory: item.subcategory,
			unit: item.unit,
			unitQuantity: item.unitQuantity,
			chainSlug: item.chainSlug,
		};

		const messages = await buildCategorizationMessages([promptItem]);
		const votes: ReverificationVote[] = [];

		for (const endpoint of endpoints) {
			try {
				const { payload, latencyMs } = await callSingleModel(
					{
						id: endpoint.id,
						provider: endpoint.provider,
						model: endpoint.model,
						endpoint: endpoint.endpoint ?? "",
						timeoutMs: endpoint.timeoutMs ?? 120_000,
						maxTokens: endpoint.maxTokens,
						maxRetries: endpoint.maxRetries,
					},
					messages,
				);

				const parsed = parseCategorizationResponse(payload, new Set([llmId]));
				const parsedItem = parsed.get(llmId);

				if (parsedItem) {
					votes.push({
						modelId: endpoint.model,
						provider: endpoint.provider,
						endpointId: endpoint.id,
						confidence: parsedItem.confidence,
						everydayName: parsedItem.everydayName,
						productType: parsedItem.productType,
						brand: parsedItem.brand,
						variant: parsedItem.variant,
						searchTags: parsedItem.searchTags,
						extractedAmount: parsedItem.extractedAmount,
						extractedUnit: parsedItem.extractedUnit,
						packAmount: parsedItem.packAmount,
						containerType: parsedItem.containerType,
						latencyMs,
					});
				}
			} catch (error) {
				log.warn("Reverification model call failed", {
					itemId: item.itemId,
					model: endpoint.model,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const { consensusType, agreementRatio, winner } = computeAgreement(votes);

		const isZeroConfidence = item.originalConfidence === 0;
		const requiresUnanimous =
			isZeroConfidence && opts.requireUnanimousForZeroConfidence;

		const consensusReached =
			consensusType !== "none" &&
			(!requiresUnanimous || consensusType === "unanimous") &&
			winner !== null;

		const finalCategorization: ParsedCategorization | null =
			consensusReached && winner
				? {
						...voteToParsedCategorization(winner),
						itemId: item.itemId,
						confidence:
							consensusType === "unanimous"
								? Math.min(...votes.map((v) => v.confidence))
								: winner.confidence * agreementRatio,
					}
				: null;

		const needsHumanReview =
			!consensusReached ||
			(finalCategorization?.confidence ?? 0) < opts.confidenceThreshold;

		const result: ReverificationResult = {
			itemId: item.itemId,
			originalName: item.originalName,
			originalConfidence: item.originalConfidence ?? 0,
			votes,
			consensusReached,
			consensusType,
			agreementRatio,
			finalCategorization,
			needsHumanReview,
		};

		await updateCategorizationFromReverification(db, item.itemId, result);
		await logReverificationDecision(item.itemId, result);

		results.push(result);
	}

	const consensusReached = results.filter((r) => r.consensusReached).length;
	const needsHumanReview = results.filter((r) => r.needsHumanReview).length;

	log.info("Reverification complete", {
		totalProcessed: results.length,
		consensusReached,
		needsHumanReview,
	});

	return {
		results,
		totalProcessed: results.length,
		consensusReached,
		needsHumanReview,
	};
}

export async function countItemsNeedingReview(): Promise<number> {
	const db = getDb();
	const result = await db.execute(sql`
		SELECT count(*)::int AS count
		FROM retailer_item_features
		WHERE categorization_needs_review = true
	`);
	const row = (result as { rows?: Array<{ count?: number }> }).rows?.[0];
	return row?.count ?? 0;
}

export async function getReviewQueue(options?: {
	limit?: number;
	offset?: number;
	confidenceBelow?: number;
}): Promise<{
	items: Array<{
		itemId: string;
		chainSlug: string | null;
		originalName: string;
		everydayName: string | null;
		productType: string | null;
		brand: string | null;
		confidence: number | null;
		model: string | null;
		categorizedAt: Date | null;
	}>;
	total: number;
}> {
	const db = getDb();
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;

	const conditions = [
		sql`ri.merged_into_id IS NULL`,
		sql`rif.categorization_needs_review = true`,
	];

	if (options?.confidenceBelow != null) {
		conditions.push(
			sql`rif.categorization_confidence < ${options.confidenceBelow}`,
		);
	}

	const whereSql = sql.join(conditions, sql` AND `);

	const rowsResult = await db.execute(sql`
		SELECT
			ri.id AS item_id,
			ri.chain_slug,
			ri.name AS original_name,
			rif.everyday_name,
			rif.product_type,
			rif.extracted_brand,
			rif.categorization_confidence,
			rif.categorization_model,
			rif.categorized_at
		FROM retailer_items ri
		INNER JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ${whereSql}
		ORDER BY rif.categorization_confidence ASC NULLS FIRST, ri.created_at DESC
		LIMIT ${limit}
		OFFSET ${offset}
	`);

	const totalResult = await db.execute(sql`
		SELECT count(*)::int AS count
		FROM retailer_items ri
		INNER JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ${whereSql}
	`);

	const rows = ((rowsResult as { rows?: unknown[] }).rows ?? []) as Array<{
		item_id: string;
		chain_slug: string | null;
		original_name: string;
		everyday_name: string | null;
		product_type: string | null;
		extracted_brand: string | null;
		categorization_confidence: number | null;
		categorization_model: string | null;
		categorized_at: Date | null;
	}>;

	const totalRow = (totalResult as { rows?: unknown[] }).rows?.[0] as
		| { count?: number }
		| undefined;

	return {
		items: rows.map((row) => ({
			itemId: row.item_id,
			chainSlug: row.chain_slug,
			originalName: row.original_name,
			everydayName: row.everyday_name,
			productType: row.product_type,
			brand: row.extracted_brand,
			confidence: row.categorization_confidence,
			model: row.categorization_model,
			categorizedAt: row.categorized_at,
		})),
		total: totalRow?.count ?? 0,
	};
}

export async function approveCategorization(
	itemId: string,
	override?: {
		everydayName?: string;
		productType?: string;
		brand?: string;
		variant?: string;
		extractedAmount?: number;
		extractedUnit?: string;
		packAmount?: number;
		containerType?: string;
		searchTags?: string[];
	},
): Promise<{ success: boolean }> {
	const db = getDb();

	const updateData: Record<string, unknown> = {
		categorizationNeedsReview: false,
		categorizationConfidence: 1,
		categorizationModel: override ? "manual-override" : "human-approved",
		categorizedAt: new Date(),
	};

	if (override) {
		if (override.everydayName !== undefined)
			updateData.everydayName = override.everydayName;
		if (override.productType !== undefined)
			updateData.productType = override.productType;
		if (override.brand !== undefined)
			updateData.extractedBrand = override.brand;
		if (override.variant !== undefined) updateData.variant = override.variant;
		if (override.extractedAmount !== undefined)
			updateData.extractedAmount = override.extractedAmount;
		if (override.extractedUnit !== undefined)
			updateData.extractedUnit = override.extractedUnit;
		if (override.packAmount !== undefined)
			updateData.packAmount = override.packAmount;
		if (override.containerType !== undefined)
			updateData.containerType = override.containerType;
		if (override.searchTags !== undefined)
			updateData.searchTags = override.searchTags;
	}

	await db
		.update(retailerItemFeatures)
		.set(updateData)
		.where(eq(retailerItemFeatures.retailerItemId, itemId));

	await logLlmDecision({
		taskType: "categorize_review",
		input: { itemId, action: "approve" },
		output: { override: override ?? null },
		modelId: "human",
		provider: "human",
		verdict: "approved",
		confidence: 1,
		reasoning: override ? "Manual override" : "Approved as-is",
	});

	return { success: true };
}

export async function rejectCategorization(
	itemId: string,
	correction: {
		everydayName?: string;
		productType?: string;
		brand?: string;
		variant?: string;
		extractedAmount?: number;
		extractedUnit?: string;
		packAmount?: number;
		containerType?: string;
		searchTags?: string[];
	},
): Promise<{ success: boolean }> {
	const db = getDb();

	await db
		.update(retailerItemFeatures)
		.set({
			everydayName: correction.everydayName ?? null,
			productType: correction.productType ?? null,
			extractedBrand: correction.brand ?? null,
			variant: correction.variant ?? null,
			extractedAmount: correction.extractedAmount ?? null,
			extractedUnit: correction.extractedUnit ?? null,
			packAmount: correction.packAmount ?? 1,
			containerType: correction.containerType ?? null,
			searchTags: correction.searchTags ?? [],
			categorizationNeedsReview: false,
			categorizationConfidence: 1,
			categorizationModel: "human-correction",
			categorizedAt: new Date(),
		})
		.where(eq(retailerItemFeatures.retailerItemId, itemId));

	await logLlmDecision({
		taskType: "categorize_review",
		input: { itemId, action: "reject" },
		output: { correction },
		modelId: "human",
		provider: "human",
		verdict: "corrected",
		confidence: 1,
		reasoning: "Human correction applied",
	});

	return { success: true };
}

export async function scheduleItemsForReverification(options?: {
	confidenceBelow?: number;
	maxItems?: number;
}): Promise<{ queued: number }> {
	const db = getDb();
	const confidenceBelow = options?.confidenceBelow ?? 0.8;
	const maxItems = options?.maxItems ?? 1000;

	const result = await db.execute(sql`
		SELECT ri.id AS item_id
		FROM retailer_items ri
		INNER JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ri.merged_into_id IS NULL
			AND rif.categorization_needs_review = true
			AND rif.categorization_confidence < ${confidenceBelow}
		ORDER BY rif.categorization_confidence ASC NULLS FIRST
		LIMIT ${maxItems}
	`);

	const rows = (result as { rows?: Array<{ item_id?: string }> }).rows ?? [];
	const itemIds = rows
		.map((r) => r.item_id)
		.filter((id): id is string => typeof id === "string" && id.length > 0);

	return { queued: itemIds.length };
}
