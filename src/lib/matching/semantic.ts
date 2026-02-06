/**
 * Semantic Matching using BGE-M3 vector embeddings.
 *
 * Two-phase execution:
 * 1. Embed products that don't have embeddings yet
 * 2. Match unlinked retailer items via pgvector nearest-neighbor search
 */

import { eq, sql } from "drizzle-orm";
import {
	productLinks,
	productMatchCandidates,
	productMatchRejections,
} from "@/db/schema";
import { loadCatalog } from "@/lib/knowledge/loader";
import { embedQuery, embedTexts, preparePassageText } from "@/lib/embeddings";
import { prepareQueryText } from "@/lib/embeddings/text";
import { normalizeWhitespace } from "@/lib/matching/normalize";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";
import {
	checkUnitQuantityMismatch,
	flagTopCandidate,
	hasPrivateLabelConflict,
	mapRetailerItem,
	type ProductCandidateRow,
	parseCandidateRows,
	queueForReview,
	type RetailerItemRow,
} from "./index";

const log = createLogger("matching");

const SEMANTIC_AUTO_LINK_THRESHOLD = Number.parseFloat(
	process.env.SEMANTIC_AUTO_LINK_THRESHOLD ?? "0.92",
);
const SEMANTIC_REVIEW_THRESHOLD = Number.parseFloat(
	process.env.SEMANTIC_REVIEW_THRESHOLD ?? "0.75",
);
const EMBEDDING_DIMENSIONS = 1024;
const SEMANTIC_MODEL_VERSION =
	process.env.SEMANTIC_MODEL_VERSION?.trim() || "bge-m3-v1";
const SEMANTIC_EMBED_PRODUCT_BATCH_SIZE = parsePositiveIntEnv(
	"SEMANTIC_EMBED_PRODUCT_BATCH_SIZE",
	500,
);

function parsePositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toPositiveInt(value: number | undefined, fallback: number): number {
	if (value == null || !Number.isFinite(value)) {
		return fallback;
	}
	const parsed = Math.floor(value);
	return parsed > 0 ? parsed : fallback;
}

function isValidEmbedding(vector: number[]): boolean {
	if (vector.length !== EMBEDDING_DIMENSIONS) {
		return false;
	}
	return vector.every((component) => Number.isFinite(component));
}

export interface SemanticMatchingResult {
	runId: string;
	processed: number;
	highConfidence: number;
	queuedForReview: number;
	noMatch: number;
	embeddingsComputed: number;
	embeddingFailures: number;
}

export async function runSemanticMatching(options?: {
	batchSize?: number;
	maxCandidates?: number;
}): Promise<SemanticMatchingResult> {
	const batchSize = toPositiveInt(options?.batchSize, 100);
	const maxCandidates = toPositiveInt(options?.maxCandidates, 5);
	const runId = generatePrefixedId("run");
	const db = getDb();

	const result: SemanticMatchingResult = {
		runId,
		processed: 0,
		highConfidence: 0,
		queuedForReview: 0,
		noMatch: 0,
		embeddingsComputed: 0,
		embeddingFailures: 0,
	};

	try {
		await loadCatalog();
	} catch (error) {
		log.warn("Knowledge catalog unavailable for semantic matching", { error });
	}

	// Phase 1: Embed products missing embeddings
	const productsToEmbed = await db.execute(sql`
			SELECT id, name, brand, category, unit, unit_quantity
			FROM products
			WHERE embedding IS NULL
			LIMIT ${SEMANTIC_EMBED_PRODUCT_BATCH_SIZE}
		`);

	const productRows = (
		Array.isArray(productsToEmbed)
			? productsToEmbed
			: ((productsToEmbed as { rows?: unknown[] }).rows ?? [])
	) as Array<{
		id: string;
		name: string;
		brand: string | null;
		category: string | null;
		unit: string | null;
		unit_quantity: string | null;
	}>;

	if (productRows.length > 0) {
		const texts = productRows.map((row) =>
			preparePassageText({
				name: row.name,
				brand: row.brand,
				category: row.category,
				unit: row.unit,
				unitQuantity: row.unit_quantity,
			}),
		);

		try {
			const embeddings = await embedTexts(texts);
			for (let i = 0; i < productRows.length; i++) {
				const row = productRows[i];
				const embedding = embeddings[i];
				if (!embedding || !isValidEmbedding(embedding)) {
					result.embeddingFailures += 1;
					log.error("Invalid product embedding computed", {
						productId: row.id,
						embeddingLength: embedding?.length ?? 0,
					});
					continue;
				}
				const vectorStr = `[${embedding.join(",")}]`;
				await db.execute(
					sql`UPDATE products SET embedding = ${vectorStr}::vector WHERE id = ${row.id}`,
				);
				result.embeddingsComputed += 1;
			}
		} catch (error) {
			result.embeddingFailures += productRows.length;
			log.error("Failed to compute product embeddings", {
				count: productRows.length,
				error,
			});
		}
		log.info("Embedded products", {
			computed: result.embeddingsComputed,
			failures: result.embeddingFailures,
		});
	}

	// Phase 2: Match unlinked retailer items
	const itemsResult = await db.execute(sql`
		SELECT
			ri.id,
			ri.name,
			ri.brand,
			ri.unit,
			ri.unit_quantity,
			ri.category,
			ri.image_url,
			ri.chain_slug,
			ri.external_id,
			'' as barcode,
			ri.normalized_unit,
			ri.normalized_quantity
		FROM retailer_items ri
		WHERE ri.merged_into_id IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
		)
		AND NOT EXISTS (
			SELECT 1 FROM product_match_queue pmq
			WHERE pmq.retailer_item_id = ri.id AND pmq.status = 'pending'
		)
		LIMIT ${batchSize}
	`);

	const itemRows = (
		Array.isArray(itemsResult)
			? itemsResult
			: ((itemsResult as { rows?: unknown[] }).rows ?? [])
	) as RetailerItemRow[];

	for (const row of itemRows) {
		const item = mapRetailerItem(row);
		const queryText = prepareQueryText(
			normalizeWhitespace(
				[item.name, item.brand, item.category].filter(Boolean).join(" "),
			),
		);

		let queryEmbedding: number[];
		try {
			queryEmbedding = await embedQuery(queryText);
		} catch (error) {
			log.error("Failed to compute query embedding", {
				itemId: item.id,
				error,
			});
			result.noMatch += 1;
			result.embeddingFailures += 1;
			continue;
		}

		if (!isValidEmbedding(queryEmbedding)) {
			log.error("Invalid query embedding computed", {
				itemId: item.id,
				embeddingLength: queryEmbedding.length,
			});
			result.noMatch += 1;
			result.embeddingFailures += 1;
			continue;
		}

		const vectorStr = `[${queryEmbedding.join(",")}]`;
		const itemCategory = item.category || null;

		const candidatesResult = await db.execute(sql`
			SELECT
				p.id,
				p.name,
				p.brand,
				p.category,
				p.unit,
				p.unit_quantity,
				p.image_url,
				p.canonical_key,
				p.normalized_unit,
				p.normalized_quantity,
				1 - (p.embedding <=> ${vectorStr}::vector) as sim_score
			FROM products p
			WHERE p.embedding IS NOT NULL
			AND (
				p.category IS NULL
				OR ${itemCategory} IS NULL
				OR p.category = ${itemCategory}
			)
			ORDER BY p.embedding <=> ${vectorStr}::vector
			LIMIT ${maxCandidates}
		`);

		const candidateRows = (
			Array.isArray(candidatesResult)
				? candidatesResult
				: ((candidatesResult as { rows?: unknown[] }).rows ?? [])
		) as ProductCandidateRow[];

		const candidates = parseCandidateRows(candidateRows);

		if (candidates.length === 0) {
			result.noMatch += 1;
			continue;
		}

		await db.transaction(async (tx) => {
			// Clear old candidates for this item
			await tx
				.delete(productMatchCandidates)
				.where(eq(productMatchCandidates.retailerItemId, item.id));

			// Store all candidates
			let rank = 1;
			for (const candidate of candidates) {
				const similarity = candidate.similarity.toFixed(6);
				await tx
					.insert(productMatchCandidates)
					.values({
						retailerItemId: item.id,
						candidateProductId: candidate.productId,
						similarity,
						matchType: "semantic",
						rank,
						matchingRunId: runId,
						modelVersion: SEMANTIC_MODEL_VERSION,
					})
					.onConflictDoUpdate({
						target: [
							productMatchCandidates.retailerItemId,
							productMatchCandidates.rank,
						],
						set: {
							candidateProductId: candidate.productId,
							similarity,
							matchType: "semantic",
							matchingRunId: runId,
							modelVersion: SEMANTIC_MODEL_VERSION,
						},
					});
				rank += 1;
			}

			// Check rejections
			const rejectedRows = await tx
				.select({
					rejectedProductId: productMatchRejections.rejectedProductId,
				})
				.from(productMatchRejections)
				.where(eq(productMatchRejections.retailerItemId, item.id));

			const rejectedSet = new Set(rejectedRows.map((r) => r.rejectedProductId));

			const bestCandidate = candidates.find(
				(c) => !rejectedSet.has(c.productId),
			);

			if (
				!bestCandidate ||
				bestCandidate.similarity < SEMANTIC_REVIEW_THRESHOLD
			) {
				result.noMatch += 1;
				return;
			}

			// Quality checks
			const unitQtyFlag = checkUnitQuantityMismatch(
				item,
				bestCandidate.product,
			);
			if (unitQtyFlag) {
				await queueForReview(tx, item.id);
				await flagTopCandidate(tx, item.id, unitQtyFlag);
				result.queuedForReview += 1;
				result.processed += 1;
				return;
			}

			if (hasPrivateLabelConflict(item, bestCandidate)) {
				await queueForReview(tx, item.id);
				await flagTopCandidate(tx, item.id, "semantic_private_label_conflict");
				result.queuedForReview += 1;
				result.processed += 1;
				return;
			}

			// Auto-link at high confidence
			if (bestCandidate.similarity >= SEMANTIC_AUTO_LINK_THRESHOLD) {
				await tx
					.insert(productLinks)
					.values({
						productId: bestCandidate.productId,
						retailerItemId: item.id,
						confidence: "ai",
					})
					.onConflictDoNothing({
						target: [productLinks.retailerItemId],
					});
				result.highConfidence += 1;
				result.processed += 1;
				return;
			}

			// Queue for review
			await queueForReview(tx, item.id);
			await flagTopCandidate(tx, item.id, "semantic_uncertain");
			result.queuedForReview += 1;
			result.processed += 1;
		});
	}

	return result;
}
