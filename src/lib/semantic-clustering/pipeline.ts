import { and, eq, sql } from "drizzle-orm";
import {
	clusterMembers,
	clusterRelations,
	productClusters,
	retailerItemFeatures,
	retailerItems,
	semanticPairDecisions,
} from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";
import { evaluatePairWithCascade } from "./llm";
import { parseRetailerItemFeature } from "./normalize";
import type { ParsedFeature, SemanticVerdict } from "./types";

const log = createLogger("matching");

interface PipelineOptions {
	featureBatchSize?: number;
	candidateSourceBatch?: number;
	candidateInsertLimit?: number;
	adjudicationBatchSize?: number;
	rebuildClusters?: boolean;
}

interface PipelineResult {
	featuresUpserted: number;
	candidatesQueued: number;
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

class UnionFind {
	private readonly parent = new Map<string, string>();

	makeSet(id: string): void {
		if (!this.parent.has(id)) {
			this.parent.set(id, id);
		}
	}

	find(id: string): string {
		this.makeSet(id);
		const current = this.parent.get(id);
		if (!current) {
			return id;
		}
		if (current === id) {
			return id;
		}
		const root = this.find(current);
		this.parent.set(id, root);
		return root;
	}

	union(a: string, b: string): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA !== rootB) {
			this.parent.set(rootB, rootA);
		}
	}

	components(ids: string[]): Map<string, string[]> {
		const grouped = new Map<string, string[]>();
		for (const id of ids) {
			const root = this.find(id);
			const list = grouped.get(root) ?? [];
			list.push(id);
			grouped.set(root, list);
		}
		return grouped;
	}
}

function decideFinalStatus(state: string): "APPROVED" | "REJECTED" | "PENDING_REVIEW" | "SYSTEM_ERROR" {
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

function pickRepresentativeName(names: Map<string, string>, ids: string[]): string {
	const candidates = ids
		.map((id) => names.get(id) ?? "")
		.filter((name) => name.length > 0)
		.sort((a, b) => a.length - b.length);
	return candidates[0] ?? "Cluster";
}

function determineRelationshipType(a: DecisionRow, b: DecisionRow): string {
	if (
		a.pack_amount_a != null &&
		a.pack_amount_b != null &&
		a.pack_amount_a !== a.pack_amount_b
	) {
		return "MULTIPACK_VARIANT";
	}
	if (
		a.container_type_a &&
		a.container_type_b &&
		a.container_type_a !== a.container_type_b
	) {
		return "CONTAINER_VARIANT";
	}
	void b;
	return "SIZE_VARIANT";
}

async function upsertFeatures(batchSize: number): Promise<number> {
	const db = getDb();
	const rowsResult = await db.execute(sql`
		SELECT
			ri.id,
			ri.name,
			ri.brand,
			ri.category,
			ri.unit,
			ri.unit_quantity
		FROM retailer_items ri
		LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ri.merged_into_id IS NULL
			AND (rif.retailer_item_id IS NULL OR rif.updated_at < ri.updated_at)
		ORDER BY ri.updated_at DESC
		LIMIT ${batchSize}
	`);

	const rows = ((rowsResult as { rows?: unknown[] }).rows ?? []) as Array<{
		id: string;
		name: string;
		brand: string | null;
		category: string | null;
		unit: string | null;
		unit_quantity: string | null;
	}>;

	if (rows.length === 0) {
		return 0;
	}

	for (const row of rows) {
		const parsed: ParsedFeature = parseRetailerItemFeature({
			retailerItemId: row.id,
			name: row.name,
			brand: row.brand,
			category: row.category,
			unit: row.unit,
			unitQuantity: row.unit_quantity,
		});

		await db
			.insert(retailerItemFeatures)
			.values({
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
			})
			.onConflictDoUpdate({
				target: [retailerItemFeatures.retailerItemId],
				set: {
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
				},
			});
	}

	return rows.length;
}

async function queueCandidates(sourceBatch: number, insertLimit: number): Promise<number> {
	const db = getDb();
	const candidatesResult = await db.execute(sql`
		WITH source AS (
			SELECT
				rif.retailer_item_id,
				rif.normalized_category,
				rif.extracted_brand,
				rif.extracted_unit,
				rif.total_amount
			FROM retailer_item_features rif
			ORDER BY rif.updated_at DESC
			LIMIT ${sourceBatch}
		)
		SELECT DISTINCT
			LEAST(s.retailer_item_id, t.retailer_item_id) AS item_a_id,
			GREATEST(s.retailer_item_id, t.retailer_item_id) AS item_b_id,
			'blocking_rule'::text AS method,
			0.5::real AS similarity_score
		FROM source s
		JOIN retailer_item_features t
			ON t.retailer_item_id != s.retailer_item_id
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
		WHERE LEAST(s.retailer_item_id, t.retailer_item_id) != GREATEST(s.retailer_item_id, t.retailer_item_id)
		LIMIT ${insertLimit}
	`);

	const candidates = ((candidatesResult as { rows?: unknown[] }).rows ?? []) as Array<{
		item_a_id: string;
		item_b_id: string;
		method: string;
		similarity_score: number;
	}>;

	let inserted = 0;
	for (const candidate of candidates) {
		const result = await db
			.insert(semanticPairDecisions)
			.values({
				itemAId: candidate.item_a_id,
				itemBId: candidate.item_b_id,
				method: candidate.method,
				similarityScore: candidate.similarity_score,
				finalStatus: "PENDING_REVIEW",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoNothing({
				target: [semanticPairDecisions.itemAId, semanticPairDecisions.itemBId],
			})
			.returning({ itemAId: semanticPairDecisions.itemAId });
		inserted += result.length;
	}

	return inserted;
}

async function adjudicatePairs(batchSize: number): Promise<{
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
		ORDER BY d.created_at ASC
		LIMIT ${batchSize}
	`);

	const rows = ((rowsResult as { rows?: unknown[] }).rows ?? []) as DecisionRow[];
	let autoApproved = 0;
	let autoRejected = 0;
	let pendingReview = 0;
	let systemErrors = 0;

	for (const row of rows) {
		const result = await evaluatePairWithCascade({
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
		});

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
				llmReasoning: result.votes.map((vote) => `${vote.modelId}: ${vote.reasoning}`).join(" | "),
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
	}

	return {
		pairsAdjudicated: rows.length,
		autoApproved,
		autoRejected,
		pendingReview,
		systemErrors,
	};
}

async function rebuildClustersFromApproved(): Promise<{
	variantClusters: number;
	baseClusters: number;
}> {
	const db = getDb();
	const approvedResult = await db.execute(sql`
		SELECT
			item_a_id,
			item_b_id,
			final_verdict,
			COALESCE(final_confidence, llm_confidence, 0) AS confidence
		FROM semantic_pair_decisions
		WHERE final_status = 'APPROVED'
	`);

	const approvedRows = ((approvedResult as { rows?: unknown[] }).rows ?? []) as Array<{
		item_a_id: string;
		item_b_id: string;
		final_verdict: SemanticVerdict;
		confidence: number;
	}>;

	// Rebuild semantics require replacing previous cluster state, even if empty.
	await db.delete(clusterRelations);
	await db.delete(clusterMembers);
	await db.delete(productClusters);

	if (approvedRows.length === 0) {
		return { variantClusters: 0, baseClusters: 0 };
	}

	const allItemIds = new Set<string>();
	for (const row of approvedRows) {
		allItemIds.add(row.item_a_id);
		allItemIds.add(row.item_b_id);
	}

	const namesRows = await db
		.select({ id: retailerItems.id, name: retailerItems.name })
		.from(retailerItems)
		.where(sql`${retailerItems.id} = ANY(${Array.from(allItemIds)}::text[])`);
	const itemNames = new Map(namesRows.map((row) => [row.id, row.name]));

	const variantUf = new UnionFind();
	for (const itemId of allItemIds) {
		variantUf.makeSet(itemId);
	}
	for (const row of approvedRows) {
		if (row.final_verdict === "EXACT_MATCH") {
			variantUf.union(row.item_a_id, row.item_b_id);
		}
	}

	const variantComponents = variantUf.components(Array.from(allItemIds));
	const itemToVariantCluster = new Map<string, string>();
	for (const ids of variantComponents.values()) {
		const clusterId = generatePrefixedId("pcl");
		const representativeItemId = ids[0] ?? null;
		const canonicalName = pickRepresentativeName(itemNames, ids);
		await db.insert(productClusters).values({
			id: clusterId,
			clusterType: "variant",
			canonicalName,
			representativeRetailerItemId: representativeItemId,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		for (const itemId of ids) {
			itemToVariantCluster.set(itemId, clusterId);
			await db.insert(clusterMembers).values({
				id: generatePrefixedId("pcm"),
				clusterId,
				retailerItemId: itemId,
				variantClusterId: null,
				isCanonical: itemId === representativeItemId,
				createdAt: new Date(),
			});
		}
	}

	const baseUf = new UnionFind();
	for (const variantId of new Set(itemToVariantCluster.values())) {
		baseUf.makeSet(variantId);
	}

	for (const row of approvedRows) {
		if (row.final_verdict !== "SAME_BASE_DIFFERENT_VARIANT") {
			continue;
		}
		const clusterA = itemToVariantCluster.get(row.item_a_id);
		const clusterB = itemToVariantCluster.get(row.item_b_id);
		if (!clusterA || !clusterB) {
			continue;
		}
		baseUf.union(clusterA, clusterB);
	}

	const baseComponents = baseUf.components(Array.from(new Set(itemToVariantCluster.values())));
	for (const variantIds of baseComponents.values()) {
		const baseClusterId = generatePrefixedId("pcl");
		const canonicalName =
			variantIds
				.map((variantId) => {
					const representative = Array.from(itemToVariantCluster.entries()).find(
						([, clusterId]) => clusterId === variantId,
					);
					return representative ? itemNames.get(representative[0]) ?? "" : "";
				})
				.find((name) => name.length > 0) ?? "Base Product";

		await db.insert(productClusters).values({
			id: baseClusterId,
			clusterType: "base",
			canonicalName,
			representativeRetailerItemId: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		for (const variantId of variantIds) {
			await db.insert(clusterMembers).values({
				id: generatePrefixedId("pcm"),
				clusterId: baseClusterId,
				retailerItemId: null,
				variantClusterId: variantId,
				isCanonical: false,
				createdAt: new Date(),
			});
		}
	}

	const detailedRowsResult = await db.execute(sql`
		SELECT
			d.item_a_id,
			d.item_b_id,
			d.final_verdict,
			COALESCE(d.final_confidence, d.llm_confidence, 0) as confidence,
			fa.pack_amount as pack_amount_a,
			fb.pack_amount as pack_amount_b,
			fa.container_type as container_type_a,
			fb.container_type as container_type_b
		FROM semantic_pair_decisions d
		JOIN retailer_item_features fa ON fa.retailer_item_id = d.item_a_id
		JOIN retailer_item_features fb ON fb.retailer_item_id = d.item_b_id
		WHERE d.final_status = 'APPROVED'
			AND d.final_verdict = 'SAME_BASE_DIFFERENT_VARIANT'
	`);

	const relationRows = ((detailedRowsResult as { rows?: unknown[] }).rows ?? []) as DecisionRow[];
	const seen = new Set<string>();
	for (const row of relationRows) {
		const fromVariant = itemToVariantCluster.get(row.item_a_id);
		const toVariant = itemToVariantCluster.get(row.item_b_id);
		if (!fromVariant || !toVariant || fromVariant === toVariant) {
			continue;
		}
		const [fromId, toId] = [fromVariant, toVariant].sort();
		const key = `${fromId}:${toId}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		await db.insert(clusterRelations).values({
			id: generatePrefixedId("pcr"),
			fromClusterId: fromId,
			toClusterId: toId,
			relationshipType: determineRelationshipType(row, row),
			confidence: 0.9,
			reasoning: "Derived from approved base-variant decision",
			createdAt: new Date(),
		});
	}

	return {
		variantClusters: variantComponents.size,
		baseClusters: baseComponents.size,
	};
}

export async function runSemanticClusteringPipeline(
	options: PipelineOptions = {},
): Promise<PipelineResult> {
	const featureBatchSize = options.featureBatchSize ?? 2000;
	const candidateSourceBatch = options.candidateSourceBatch ?? 1000;
	const candidateInsertLimit = options.candidateInsertLimit ?? 5000;
	const adjudicationBatchSize = options.adjudicationBatchSize ?? 200;
	const rebuildClusters = options.rebuildClusters ?? true;

	const featuresUpserted = await upsertFeatures(featureBatchSize);
	const candidatesQueued = await queueCandidates(
		candidateSourceBatch,
		candidateInsertLimit,
	);
	const adjudication = await adjudicatePairs(adjudicationBatchSize);
	const clusters = rebuildClusters
		? await rebuildClustersFromApproved()
		: { variantClusters: 0, baseClusters: 0 };

	const result: PipelineResult = {
		featuresUpserted,
		candidatesQueued,
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
