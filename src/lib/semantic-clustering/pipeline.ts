import { and, eq, sql } from "drizzle-orm";
import { embedTexts, preparePassageText } from "@/lib/embeddings";
import { logLlmDecision } from "@/lib/llm-observability";
import {
	canonicalSkus,
	retailerItemFeatures,
	semanticPairDecisions,
} from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";
import { evaluatePairsWithCascadeBatch } from "./llm";
import { parseRetailerItemFeature } from "./normalize";
import type { ParsedFeature, SemanticVerdict } from "./types";

const log = createLogger("matching");

interface PipelineOptions {
	featureBatchSize?: number;
	embeddingBackfillBatchSize?: number;
	candidateSourceBatch?: number;
	candidateInsertLimit?: number;
	adjudicationBatchSize?: number;
	llmPromptBatchSize?: number;
	semanticNeighborCount?: number;
	lexicalNeighborCount?: number;
	scoreAutoApproveThreshold?: number;
	scoreAutoRejectThreshold?: number;
	embeddingWeight?: number;
	lexicalWeight?: number;
	structuredWeight?: number;
	categoryWeight?: number;
}

interface PipelineResult {
	featuresUpserted: number;
	featureEmbeddingsUpserted: number;
	embeddingsBackfilled: number;
	candidatesQueued: number;
	scoringAutoApproved: number;
	scoringAutoRejected: number;
	scoringPendingReview: number;
	pairsAdjudicated: number;
	autoApproved: number;
	autoRejected: number;
	pendingReview: number;
	systemErrors: number;
	variantClusters: number;
	baseClusters: number;
}

interface DecisionRow {
	item_a_id: string;
	item_b_id: string;
	normalized_name_a: string;
	normalized_name_b: string;
	extracted_brand_a: string | null;
	extracted_brand_b: string | null;
	normalized_category_a: string | null;
	normalized_category_b: string | null;
	total_amount_a: number | null;
	total_amount_b: number | null;
	extracted_unit_a: string | null;
	extracted_unit_b: string | null;
	pack_amount_a: number | null;
	pack_amount_b: number | null;
	container_type_a: string | null;
	container_type_b: string | null;
	item_name_a: string;
	item_name_b: string;
}

interface CandidateQueueConfig {
	sourceBatch: number;
	insertLimit: number;
	semanticNeighborCount: number;
	lexicalNeighborCount: number;
	autoApproveThreshold: number;
	autoRejectThreshold: number;
	embeddingWeight: number;
	lexicalWeight: number;
	structuredWeight: number;
	categoryWeight: number;
}

interface CandidateQueueResult {
	inserted: number;
	autoApproved: number;
	autoRejected: number;
	pendingReview: number;
}

interface FeatureEmbeddingRow {
	retailerItemId: string;
	name: string;
	everydayName: string | null;
	brand: string | null;
	extractedBrand: string | null;
	variant: string | null;
	category: string | null;
	unit: string | null;
	unitQuantity: string | null;
}

function getRows<T>(result: unknown): T[] {
	if (Array.isArray(result)) {
		return result as T[];
	}
	return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

function toBoolFlag(
	value: number | string | boolean | null | undefined,
): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value > 0;
	}
	if (typeof value === "string") {
		return (
			value === "1" ||
			value.toLowerCase() === "t" ||
			value.toLowerCase() === "true"
		);
	}
	return false;
}

function buildPairId(itemAId: string, itemBId: string): string {
	return `${itemAId}|${itemBId}`;
}

function decideFinalStatus(
	state: string,
): "APPROVED" | "REJECTED" | "PENDING_REVIEW" | "SYSTEM_ERROR" {
	if (state === "AUTO_APPROVED") {
		return "APPROVED";
	}
	if (state === "AUTO_REJECTED") {
		return "REJECTED";
	}
	if (state === "SYSTEM_ERROR") {
		return "SYSTEM_ERROR";
	}
	return "PENDING_REVIEW";
}

function buildFeatureEmbeddingText(row: FeatureEmbeddingRow): string {
	return preparePassageText({
		name: row.everydayName ?? row.name,
		brand: row.extractedBrand ?? row.brand,
		variant: row.variant,
		category: row.category,
		unit: row.unit,
		unitQuantity: row.unitQuantity,
	});
}

function toVectorLiteral(vector: readonly number[]): string {
	return `[${vector.join(",")}]`;
}

async function embedFeatureRows(
	rows: readonly FeatureEmbeddingRow[],
): Promise<Map<string, number[]>> {
	if (rows.length === 0) {
		return new Map();
	}

	const texts = rows.map((row) => buildFeatureEmbeddingText(row));
	try {
		const embeddings = await embedTexts(texts);
		if (embeddings.length !== rows.length) {
			log.warn("Embedding output length mismatch for feature rows", {
				rowCount: rows.length,
				embeddingCount: embeddings.length,
			});
		}

		const vectorsByItemId = new Map<string, number[]>();
		for (const [index, row] of rows.entries()) {
			const vector = embeddings[index];
			if (!vector) {
				continue;
			}
			vectorsByItemId.set(row.retailerItemId, vector);
		}
		return vectorsByItemId;
	} catch (error) {
		log.warn("Failed to generate embeddings for retailer item features", {
			rowCount: rows.length,
			error,
		});
		return new Map();
	}
}

async function upsertFeatures(batchSize: number): Promise<{
	featuresUpserted: number;
	featureEmbeddingsUpserted: number;
}> {
	const db = getDb();
	const rowsResult = await db.execute(sql`
		SELECT
			ri.id,
			ri.name,
			ri.brand,
			ri.category,
			ri.unit,
			ri.unit_quantity,
			rif.everyday_name,
			rif.extracted_brand,
			rif.variant
		FROM retailer_items ri
		LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ri.merged_into_id IS NULL
			AND (rif.retailer_item_id IS NULL OR rif.updated_at < ri.created_at)
		ORDER BY ri.created_at DESC
		LIMIT ${batchSize}
	`);

	const rows = getRows<{
		id: string;
		name: string;
		brand: string | null;
		category: string | null;
		unit: string | null;
		unit_quantity: string | null;
		everyday_name: string | null;
		extracted_brand: string | null;
		variant: string | null;
	}>(rowsResult);

	if (rows.length === 0) {
		return { featuresUpserted: 0, featureEmbeddingsUpserted: 0 };
	}

	const embeddingsByItemId = await embedFeatureRows(
		rows.map((row) => ({
			retailerItemId: row.id,
			name: row.name,
			everydayName: row.everyday_name,
			brand: row.brand,
			extractedBrand: row.extracted_brand,
			variant: row.variant,
			category: row.category,
			unit: row.unit,
			unitQuantity: row.unit_quantity,
		})),
	);

	let featureEmbeddingsUpserted = 0;
	for (const row of rows) {
		const parsed: ParsedFeature = parseRetailerItemFeature({
			retailerItemId: row.id,
			name: row.name,
			brand: row.brand,
			category: row.category,
			unit: row.unit,
			unitQuantity: row.unit_quantity,
		});
		const embedding = embeddingsByItemId.get(row.id);
		const values = {
			id: generatePrefixedId("rif"),
			retailerItemId: row.id,
			normalizedName: parsed.normalizedName,
			normalizedCategory: parsed.normalizedCategory,
			extractedBrand: parsed.extractedBrand,
			extractedAmount: parsed.extractedAmount,
			extractedUnit: parsed.extractedUnit,
			isCountItem: parsed.isCountItem,
			isMultipack: parsed.isMultipack,
			packAmount: parsed.packAmount,
			unitAmount: parsed.unitAmount,
			totalAmount: parsed.totalAmount,
			containerType: parsed.containerType,
			blockingKeys: parsed.blockingKeys,
			updatedAt: new Date(),
			...(embedding ? { embedding } : {}),
		};
		const updateSet = {
			normalizedName: parsed.normalizedName,
			normalizedCategory: parsed.normalizedCategory,
			extractedBrand: parsed.extractedBrand,
			extractedAmount: parsed.extractedAmount,
			extractedUnit: parsed.extractedUnit,
			isCountItem: parsed.isCountItem,
			isMultipack: parsed.isMultipack,
			packAmount: parsed.packAmount,
			unitAmount: parsed.unitAmount,
			totalAmount: parsed.totalAmount,
			containerType: parsed.containerType,
			blockingKeys: parsed.blockingKeys,
			updatedAt: new Date(),
			...(embedding ? { embedding } : {}),
		};

		await db
			.insert(retailerItemFeatures)
			.values(values)
			.onConflictDoUpdate({
				target: [retailerItemFeatures.retailerItemId],
				set: updateSet,
			});

		if (embedding) {
			featureEmbeddingsUpserted += 1;
		}
	}

	return { featuresUpserted: rows.length, featureEmbeddingsUpserted };
}

export async function backfillMissingFeatureEmbeddings(
	batchSize: number,
): Promise<number> {
	if (batchSize <= 0) {
		return 0;
	}

	const db = getDb();
	return await db.transaction(async (tx) => {
		const rowsResult = await tx.execute(sql`
			SELECT
				rif.retailer_item_id,
				ri.name,
				ri.brand,
				ri.category,
				ri.unit,
				ri.unit_quantity,
				rif.everyday_name,
				rif.extracted_brand,
				rif.variant
			FROM retailer_item_features rif
			JOIN retailer_items ri ON ri.id = rif.retailer_item_id
			WHERE ri.merged_into_id IS NULL
				AND (
					rif.embedding IS NULL
					OR (
						rif.categorized_at IS NOT NULL
						AND rif.updated_at < rif.categorized_at
					)
				)
			LIMIT ${batchSize}
			FOR UPDATE OF rif SKIP LOCKED
		`);

		const rows = getRows<{
			retailer_item_id: string;
			name: string;
			brand: string | null;
			category: string | null;
			unit: string | null;
			unit_quantity: string | null;
			everyday_name: string | null;
			extracted_brand: string | null;
			variant: string | null;
		}>(rowsResult);
		if (rows.length === 0) {
			return 0;
		}

		const embeddingsByItemId = await embedFeatureRows(
			rows.map((row) => ({
				retailerItemId: row.retailer_item_id,
				name: row.name,
				everydayName: row.everyday_name,
				brand: row.brand,
				extractedBrand: row.extracted_brand,
				variant: row.variant,
				category: row.category,
				unit: row.unit,
				unitQuantity: row.unit_quantity,
			})),
		);

		const updateRows: Array<{ retailerItemId: string; vectorLiteral: string }> =
			[];
		for (const row of rows) {
			const embedding = embeddingsByItemId.get(row.retailer_item_id);
			if (!embedding) {
				continue;
			}
			updateRows.push({
				retailerItemId: row.retailer_item_id,
				vectorLiteral: toVectorLiteral(embedding),
			});
		}

		if (updateRows.length === 0) {
			return 0;
		}

		const values = updateRows.map(
			(row) => sql`(${row.retailerItemId}::text, ${row.vectorLiteral}::vector)`,
		);
		await tx.execute(sql`
			WITH updates(retailer_item_id, embedding) AS (
				VALUES ${sql.join(values, sql`, `)}
			)
			UPDATE retailer_item_features rif
			SET embedding = updates.embedding,
				updated_at = NOW()
			FROM updates
			WHERE rif.retailer_item_id = updates.retailer_item_id
		`);

		return updateRows.length;
	});
}

function heuristicVerdictFromCandidate(input: {
	packMatch: boolean;
	containerMatch: boolean;
	amountRatio: number;
}): SemanticVerdict {
	const exactAmount =
		Number.isFinite(input.amountRatio) && input.amountRatio <= 1.08;
	if (input.packMatch && input.containerMatch && exactAmount) {
		return "EXACT_MATCH";
	}
	return "SAME_BASE_DIFFERENT_VARIANT";
}

async function queueCandidates(
	config: CandidateQueueConfig,
): Promise<CandidateQueueResult> {
	const db = getDb();
	const candidatesResult = await db.execute(sql`
		WITH source AS (
			SELECT
				rif.retailer_item_id,
				rif.normalized_name,
				rif.normalized_category,
				rif.extracted_brand,
				rif.extracted_unit,
				rif.total_amount,
				rif.pack_amount,
				rif.container_type,
				rif.embedding
			FROM retailer_item_features rif
			ORDER BY rif.updated_at DESC
			LIMIT ${config.sourceBatch}
		),
		rule_candidates AS (
			SELECT
				s.retailer_item_id AS source_id,
				t.retailer_item_id AS target_id,
				'rules'::text AS retrieval_source,
				CASE
					WHEN s.embedding IS NOT NULL AND t.embedding IS NOT NULL
						THEN (1 - (s.embedding <=> t.embedding))::real
					ELSE NULL::real
				END AS embedding_similarity,
				similarity(s.normalized_name, t.normalized_name)::real AS lexical_similarity,
				(COALESCE(s.normalized_category, '') = COALESCE(t.normalized_category, '')) AS same_category,
				(s.extracted_brand IS NOT NULL AND t.extracted_brand IS NOT NULL AND s.extracted_brand = t.extracted_brand) AS same_brand,
				(s.extracted_brand IS NOT NULL AND t.extracted_brand IS NOT NULL AND s.extracted_brand <> t.extracted_brand) AS brand_conflict,
				(s.extracted_unit IS NULL OR t.extracted_unit IS NULL OR s.extracted_unit = t.extracted_unit) AS unit_compatible,
				CASE
					WHEN s.total_amount IS NULL OR t.total_amount IS NULL OR LEAST(s.total_amount, t.total_amount) <= 0
						THEN 1::real
					ELSE (GREATEST(s.total_amount, t.total_amount) / LEAST(s.total_amount, t.total_amount))::real
				END AS amount_ratio,
				(COALESCE(s.pack_amount, 1) = COALESCE(t.pack_amount, 1)) AS pack_match,
				(COALESCE(s.container_type, '') = COALESCE(t.container_type, '')) AS container_match
			FROM source s
			JOIN retailer_item_features t
				ON t.retailer_item_id <> s.retailer_item_id
				AND s.extracted_brand IS NOT NULL
				AND t.extracted_brand IS NOT NULL
				AND COALESCE(t.normalized_category, '') = COALESCE(s.normalized_category, '')
				AND COALESCE(t.extracted_brand, '') = COALESCE(s.extracted_brand, '')
				AND (
					s.extracted_unit IS NULL
					OR t.extracted_unit IS NULL
					OR s.extracted_unit = t.extracted_unit
				)
				AND (
					s.total_amount IS NULL
					OR t.total_amount IS NULL
					OR abs(s.total_amount - t.total_amount) <= greatest(0.1, 0.15 * greatest(s.total_amount, t.total_amount))
				)
		),
			semantic_candidates AS (
			SELECT
				s.retailer_item_id AS source_id,
				t.retailer_item_id AS target_id,
				'embedding'::text AS retrieval_source,
				(1 - (s.embedding <=> t.embedding))::real AS embedding_similarity,
				similarity(s.normalized_name, t.normalized_name)::real AS lexical_similarity,
				(COALESCE(s.normalized_category, '') = COALESCE(t.normalized_category, '')) AS same_category,
				(s.extracted_brand IS NOT NULL AND t.extracted_brand IS NOT NULL AND s.extracted_brand = t.extracted_brand) AS same_brand,
				(s.extracted_brand IS NOT NULL AND t.extracted_brand IS NOT NULL AND s.extracted_brand <> t.extracted_brand) AS brand_conflict,
				(s.extracted_unit IS NULL OR t.extracted_unit IS NULL OR s.extracted_unit = t.extracted_unit) AS unit_compatible,
				CASE
					WHEN s.total_amount IS NULL OR t.total_amount IS NULL OR LEAST(s.total_amount, t.total_amount) <= 0
						THEN 1::real
					ELSE (GREATEST(s.total_amount, t.total_amount) / LEAST(s.total_amount, t.total_amount))::real
				END AS amount_ratio,
				(COALESCE(s.pack_amount, 1) = COALESCE(t.pack_amount, 1)) AS pack_match,
				(COALESCE(s.container_type, '') = COALESCE(t.container_type, '')) AS container_match
				FROM source s
				JOIN LATERAL (
					SELECT
						t.retailer_item_id,
						t.normalized_name,
						t.normalized_category,
						t.extracted_brand,
					t.extracted_unit,
					t.total_amount,
					t.pack_amount,
					t.container_type,
						t.embedding
					FROM retailer_item_features t
					WHERE t.retailer_item_id <> s.retailer_item_id
						AND s.embedding IS NOT NULL
						AND t.embedding IS NOT NULL
					ORDER BY s.embedding <=> t.embedding
					LIMIT ${config.semanticNeighborCount}
				) t ON true
				WHERE s.embedding IS NOT NULL
			),
		lexical_candidates AS (
			SELECT
				s.retailer_item_id AS source_id,
				t.retailer_item_id AS target_id,
				'ngram'::text AS retrieval_source,
				CASE
					WHEN s.embedding IS NOT NULL AND t.embedding IS NOT NULL
						THEN (1 - (s.embedding <=> t.embedding))::real
					ELSE NULL::real
				END AS embedding_similarity,
				t.lexical_similarity,
				(COALESCE(s.normalized_category, '') = COALESCE(t.normalized_category, '')) AS same_category,
				(s.extracted_brand IS NOT NULL AND t.extracted_brand IS NOT NULL AND s.extracted_brand = t.extracted_brand) AS same_brand,
				(s.extracted_brand IS NOT NULL AND t.extracted_brand IS NOT NULL AND s.extracted_brand <> t.extracted_brand) AS brand_conflict,
				(s.extracted_unit IS NULL OR t.extracted_unit IS NULL OR s.extracted_unit = t.extracted_unit) AS unit_compatible,
				CASE
					WHEN s.total_amount IS NULL OR t.total_amount IS NULL OR LEAST(s.total_amount, t.total_amount) <= 0
						THEN 1::real
					ELSE (GREATEST(s.total_amount, t.total_amount) / LEAST(s.total_amount, t.total_amount))::real
				END AS amount_ratio,
				(COALESCE(s.pack_amount, 1) = COALESCE(t.pack_amount, 1)) AS pack_match,
				(COALESCE(s.container_type, '') = COALESCE(t.container_type, '')) AS container_match
			FROM source s
				JOIN LATERAL (
					SELECT
						t.retailer_item_id,
						t.normalized_name,
						t.normalized_category,
						t.extracted_brand,
						t.extracted_unit,
						t.total_amount,
						t.pack_amount,
						t.container_type,
						t.embedding,
						similarity(s.normalized_name, t.normalized_name)::real AS lexical_similarity
					FROM retailer_item_features t
					WHERE t.retailer_item_id <> s.retailer_item_id
					ORDER BY t.normalized_name <-> s.normalized_name
					LIMIT ${config.lexicalNeighborCount}
				) t ON true
				WHERE t.lexical_similarity >= 0.12
			),
		combined_candidates AS (
			SELECT * FROM rule_candidates
			UNION ALL
			SELECT * FROM semantic_candidates
			UNION ALL
			SELECT * FROM lexical_candidates
		),
		dedup_candidates AS (
			SELECT
				LEAST(source_id, target_id) AS item_a_id,
				GREATEST(source_id, target_id) AS item_b_id,
				string_agg(DISTINCT retrieval_source, ',') AS retrieval_sources,
				MAX(embedding_similarity)::real AS embedding_similarity,
				MAX(lexical_similarity)::real AS lexical_similarity,
				MAX(amount_ratio)::real AS amount_ratio,
				BOOL_OR(same_category) AS same_category,
				BOOL_OR(same_brand) AS same_brand,
				BOOL_OR(brand_conflict) AS brand_conflict,
				BOOL_OR(unit_compatible) AS unit_compatible,
				BOOL_OR(pack_match) AS pack_match,
				BOOL_OR(container_match) AS container_match
			FROM combined_candidates
			GROUP BY 1, 2
		),
		scored_candidates AS (
			SELECT
				item_a_id,
				item_b_id,
				retrieval_sources,
				embedding_similarity,
				lexical_similarity,
				amount_ratio,
				same_category,
				same_brand,
				brand_conflict,
				unit_compatible,
				pack_match,
				container_match,
				(
					0.35 * CASE WHEN same_brand THEN 1 ELSE 0.2 END +
					0.25 * CASE WHEN unit_compatible THEN 1 ELSE 0 END +
					0.20 * CASE
						WHEN amount_ratio <= 1.25 THEN 1
						WHEN amount_ratio <= 2 THEN 0.6
						ELSE 0
					END +
					0.10 * CASE WHEN pack_match THEN 1 ELSE 0.5 END +
					0.10 * CASE WHEN container_match THEN 1 ELSE 0.5 END
				)::real AS structured_similarity,
				CASE WHEN same_category THEN 1::real ELSE 0.35::real END AS category_prior
			FROM dedup_candidates
		)
		SELECT
			item_a_id,
			item_b_id,
			retrieval_sources,
			COALESCE(embedding_similarity, 0)::real AS embedding_similarity,
			COALESCE(lexical_similarity, 0)::real AS lexical_similarity,
			structured_similarity,
			category_prior,
			(
				${config.embeddingWeight} * COALESCE(embedding_similarity, 0) +
				${config.lexicalWeight} * COALESCE(lexical_similarity, 0) +
				${config.structuredWeight} * structured_similarity +
				${config.categoryWeight} * category_prior
			)::real AS composite_score,
			amount_ratio,
			CASE WHEN same_brand THEN 1 ELSE 0 END AS same_brand_flag,
			CASE WHEN brand_conflict THEN 1 ELSE 0 END AS brand_conflict_flag,
			CASE WHEN same_category THEN 1 ELSE 0 END AS same_category_flag,
			CASE WHEN unit_compatible THEN 1 ELSE 0 END AS unit_compatible_flag,
			CASE WHEN pack_match THEN 1 ELSE 0 END AS pack_match_flag,
			CASE WHEN container_match THEN 1 ELSE 0 END AS container_match_flag
		FROM scored_candidates
		WHERE NOT (
			(NOT unit_compatible AND COALESCE(embedding_similarity, 0) < 0.95)
			OR (amount_ratio > 3.5 AND COALESCE(embedding_similarity, 0) < 0.96)
			OR (brand_conflict AND COALESCE(embedding_similarity, 0) < 0.97 AND COALESCE(lexical_similarity, 0) < 0.8)
			OR (COALESCE(embedding_similarity, 0) < 0.32 AND COALESCE(lexical_similarity, 0) < 0.2)
		)
		ORDER BY composite_score DESC
		LIMIT ${config.insertLimit}
	`);

	const candidates = getRows<{
		item_a_id: string;
		item_b_id: string;
		retrieval_sources: string | null;
		embedding_similarity: number;
		lexical_similarity: number;
		structured_similarity: number;
		category_prior: number;
		composite_score: number;
		amount_ratio: number;
		same_brand_flag: number | string | boolean;
		brand_conflict_flag: number | string | boolean;
		same_category_flag: number | string | boolean;
		unit_compatible_flag: number | string | boolean;
		pack_match_flag: number | string | boolean;
		container_match_flag: number | string | boolean;
	}>(candidatesResult);

	let inserted = 0;
	let autoApproved = 0;
	let autoRejected = 0;
	let pendingReview = 0;

	for (const candidate of candidates) {
		const compositeScore = clamp01(candidate.composite_score);
		const sameBrand = toBoolFlag(candidate.same_brand_flag);
		const brandConflict = toBoolFlag(candidate.brand_conflict_flag);
		const packMatch = toBoolFlag(candidate.pack_match_flag);
		const containerMatch = toBoolFlag(candidate.container_match_flag);
		const amountRatio = Number.isFinite(candidate.amount_ratio)
			? Math.max(1, candidate.amount_ratio)
			: 1;
		const embeddingSimilarity = clamp01(candidate.embedding_similarity);

		let finalStatus: "APPROVED" | "REJECTED" | "PENDING_REVIEW" =
			"PENDING_REVIEW";
		let finalVerdict: SemanticVerdict | null = null;
		let finalConfidence: number | null = null;
		let llmReasoning: string | null = null;

		const allowAutoApprove =
			compositeScore >= config.autoApproveThreshold &&
			(!brandConflict || embeddingSimilarity >= 0.985);

		if (allowAutoApprove) {
			finalStatus = "APPROVED";
			finalVerdict = heuristicVerdictFromCandidate({
				packMatch,
				containerMatch,
				amountRatio,
			});
			finalConfidence = compositeScore;
			llmReasoning = `Heuristic auto-approve (score=${compositeScore.toFixed(3)}, sameBrand=${sameBrand})`;
		} else if (compositeScore <= config.autoRejectThreshold) {
			finalStatus = "REJECTED";
			finalVerdict = "MISMATCH";
			finalConfidence = clamp01(1 - compositeScore);
			llmReasoning = `Heuristic auto-reject (score=${compositeScore.toFixed(3)})`;
		}

		const result = await db
			.insert(semanticPairDecisions)
			.values({
				itemAId: candidate.item_a_id,
				itemBId: candidate.item_b_id,
				method: `hybrid:${candidate.retrieval_sources ?? "unknown"}`,
				similarityScore: compositeScore,
				finalStatus,
				finalVerdict,
				finalConfidence,
				llmReasoning,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoNothing({
				target: [semanticPairDecisions.itemAId, semanticPairDecisions.itemBId],
			})
			.returning({ itemAId: semanticPairDecisions.itemAId });

		if (result.length === 0) {
			continue;
		}

		inserted += 1;
		if (finalStatus === "APPROVED") {
			autoApproved += 1;
		} else if (finalStatus === "REJECTED") {
			autoRejected += 1;
		} else {
			pendingReview += 1;
		}
	}

	return { inserted, autoApproved, autoRejected, pendingReview };
}

async function adjudicatePairs(
	batchSize: number,
	llmPromptBatchSize: number,
): Promise<{
	pairsAdjudicated: number;
	autoApproved: number;
	autoRejected: number;
	pendingReview: number;
	systemErrors: number;
}> {
	const db = getDb();
	const rowsResult = await db.execute(sql`
		SELECT
			d.item_a_id,
			d.item_b_id,
			fa.normalized_name AS normalized_name_a,
			fb.normalized_name AS normalized_name_b,
			fa.extracted_brand AS extracted_brand_a,
			fb.extracted_brand AS extracted_brand_b,
			fa.normalized_category AS normalized_category_a,
			fb.normalized_category AS normalized_category_b,
			fa.total_amount AS total_amount_a,
			fb.total_amount AS total_amount_b,
			fa.extracted_unit AS extracted_unit_a,
			fb.extracted_unit AS extracted_unit_b,
			fa.pack_amount AS pack_amount_a,
			fb.pack_amount AS pack_amount_b,
			fa.container_type AS container_type_a,
			fb.container_type AS container_type_b,
			ria.name AS item_name_a,
			rib.name AS item_name_b
		FROM semantic_pair_decisions d
		JOIN retailer_item_features fa ON fa.retailer_item_id = d.item_a_id
		JOIN retailer_item_features fb ON fb.retailer_item_id = d.item_b_id
		JOIN retailer_items ria ON ria.id = d.item_a_id
		JOIN retailer_items rib ON rib.id = d.item_b_id
		WHERE d.llm_verdict IS NULL
			AND d.final_status = 'PENDING_REVIEW'
		ORDER BY d.created_at ASC
		LIMIT ${batchSize}
	`);

	const rows = getRows<DecisionRow>(rowsResult);
	let autoApproved = 0;
	let autoRejected = 0;
	let pendingReview = 0;
	let systemErrors = 0;

	for (let offset = 0; offset < rows.length; offset += llmPromptBatchSize) {
		const batchRows = rows.slice(offset, offset + llmPromptBatchSize);
		const results = await evaluatePairsWithCascadeBatch({
			pairs: batchRows.map((row) => ({
				pairId: buildPairId(row.item_a_id, row.item_b_id),
				itemA: {
					name: row.item_name_a,
					brand: row.extracted_brand_a,
					category: row.normalized_category_a,
					normalizedName: row.normalized_name_a,
					amount: row.total_amount_a,
					unit: row.extracted_unit_a,
					packAmount: row.pack_amount_a ?? 1,
					containerType: row.container_type_a,
				},
				itemB: {
					name: row.item_name_b,
					brand: row.extracted_brand_b,
					category: row.normalized_category_b,
					normalizedName: row.normalized_name_b,
					amount: row.total_amount_b,
					unit: row.extracted_unit_b,
					packAmount: row.pack_amount_b ?? 1,
					containerType: row.container_type_b,
				},
			})),
		});

		for (const row of batchRows) {
			const pairId = buildPairId(row.item_a_id, row.item_b_id);
			const result = results.get(pairId) ?? {
				votes: [],
				finalVerdict: "UNCERTAIN" as const,
				finalConfidence: 0,
				consensusScore: 0,
				decisionState: "SYSTEM_ERROR" as const,
				systemError: "Missing batched adjudication result",
			};

			const finalStatus = decideFinalStatus(result.decisionState);
			if (finalStatus === "APPROVED") {
				autoApproved += 1;
			} else if (finalStatus === "REJECTED") {
				autoRejected += 1;
			} else if (finalStatus === "SYSTEM_ERROR") {
				systemErrors += 1;
			} else {
				pendingReview += 1;
			}

			await db
				.update(semanticPairDecisions)
				.set({
					llmVerdict: result.finalVerdict,
					llmConfidence: result.finalConfidence,
					llmReasoning: result.votes
						.map((vote) => `${vote.modelId}: ${vote.reasoning}`)
						.join(" | "),
					consensusScore: result.consensusScore,
					votesJson: JSON.stringify(result.votes),
					finalVerdict: result.finalVerdict,
					finalConfidence: result.finalConfidence,
					finalStatus,
					systemError: result.systemError,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(semanticPairDecisions.itemAId, row.item_a_id),
						eq(semanticPairDecisions.itemBId, row.item_b_id),
					),
				);

			try {
				await logLlmDecision({
					taskType: "pair_match",
					input: {
						pairId,
						itemAId: row.item_a_id,
						itemBId: row.item_b_id,
						itemA: {
							name: row.item_name_a,
							brand: row.extracted_brand_a,
							category: row.normalized_category_a,
							amount: row.total_amount_a,
							unit: row.extracted_unit_a,
							packAmount: row.pack_amount_a ?? 1,
							containerType: row.container_type_a,
						},
						itemB: {
							name: row.item_name_b,
							brand: row.extracted_brand_b,
							category: row.normalized_category_b,
							amount: row.total_amount_b,
							unit: row.extracted_unit_b,
							packAmount: row.pack_amount_b ?? 1,
							containerType: row.container_type_b,
						},
					},
					output: {
						finalVerdict: result.finalVerdict,
						finalConfidence: result.finalConfidence,
						consensusScore: result.consensusScore,
						votes: result.votes,
						decisionState: result.decisionState,
						systemError: result.systemError,
					},
					modelId:
						result.votes.map((vote) => vote.modelId).join(",") || "heuristic",
					provider:
						result.votes.map((vote) => vote.provider).join(",") ||
						"rule-engine",
					verdict: result.finalVerdict,
					confidence: result.finalConfidence,
					reasoning:
						result.votes
							.map((vote) => `${vote.modelId}:${vote.reasoning}`)
							.join(" | ") ||
						(result.systemError ?? "No reasoning"),
				});
			} catch (error) {
				log.warn("Failed to persist semantic LLM decision log", {
					error: String(error),
					pairId,
				});
			}
		}
	}

	return {
		pairsAdjudicated: rows.length,
		autoApproved,
		autoRejected,
		pendingReview,
		systemErrors,
	};
}

async function getCatalogStats(): Promise<{
	variantClusters: number;
	baseClusters: number;
}> {
	const db = getDb();
	const [stats] = await db
		.select({
			variantClusters: sql<number>`count(*) FILTER (WHERE ${canonicalSkus.isBaseProduct} = false AND ${canonicalSkus.mergedIntoId} IS NULL)`,
			baseClusters: sql<number>`count(*) FILTER (WHERE ${canonicalSkus.isBaseProduct} = true AND ${canonicalSkus.mergedIntoId} IS NULL)`,
		})
		.from(canonicalSkus);

	return stats ?? { variantClusters: 0, baseClusters: 0 };
}

export async function runSemanticClusteringPipeline(
	options: PipelineOptions = {},
): Promise<PipelineResult> {
	const featureBatchSize = options.featureBatchSize ?? 2000;
	const embeddingBackfillBatchSize = options.embeddingBackfillBatchSize ?? 2000;
	const candidateSourceBatch = options.candidateSourceBatch ?? 1000;
	const candidateInsertLimit = options.candidateInsertLimit ?? 5000;
	const adjudicationBatchSize = options.adjudicationBatchSize ?? 200;
	const llmPromptBatchSize = options.llmPromptBatchSize ?? 50;
	const semanticNeighborCount = options.semanticNeighborCount ?? 80;
	const lexicalNeighborCount = options.lexicalNeighborCount ?? 80;
	const scoreAutoApproveThreshold = options.scoreAutoApproveThreshold ?? 0.93;
	const scoreAutoRejectThreshold = options.scoreAutoRejectThreshold ?? 0.4;
	const embeddingWeight = options.embeddingWeight ?? 0.45;
	const lexicalWeight = options.lexicalWeight ?? 0.3;
	const structuredWeight = options.structuredWeight ?? 0.2;
	const categoryWeight = options.categoryWeight ?? 0.05;

	const featureUpsertResult = await upsertFeatures(featureBatchSize);
	const embeddingsBackfilled = await backfillMissingFeatureEmbeddings(
		embeddingBackfillBatchSize,
	);
	const candidateQueue = await queueCandidates({
		sourceBatch: candidateSourceBatch,
		insertLimit: candidateInsertLimit,
		semanticNeighborCount,
		lexicalNeighborCount,
		autoApproveThreshold: scoreAutoApproveThreshold,
		autoRejectThreshold: scoreAutoRejectThreshold,
		embeddingWeight,
		lexicalWeight,
		structuredWeight,
		categoryWeight,
	});
	const adjudication = await adjudicatePairs(
		adjudicationBatchSize,
		llmPromptBatchSize,
	);
	const clusters = await getCatalogStats();

	const result: PipelineResult = {
		featuresUpserted: featureUpsertResult.featuresUpserted,
		featureEmbeddingsUpserted: featureUpsertResult.featureEmbeddingsUpserted,
		embeddingsBackfilled,
		candidatesQueued: candidateQueue.inserted,
		scoringAutoApproved: candidateQueue.autoApproved,
		scoringAutoRejected: candidateQueue.autoRejected,
		scoringPendingReview: candidateQueue.pendingReview,
		pairsAdjudicated: adjudication.pairsAdjudicated,
		autoApproved: adjudication.autoApproved,
		autoRejected: adjudication.autoRejected,
		pendingReview: adjudication.pendingReview,
		systemErrors: adjudication.systemErrors,
		variantClusters: clusters.variantClusters,
		baseClusters: clusters.baseClusters,
	};

	log.info("Semantic clustering pipeline run completed", { ...result });
	return result;
}
