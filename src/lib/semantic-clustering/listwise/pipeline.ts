import { eq, inArray, sql } from "drizzle-orm";
import { canonicalSkus, retailerItemBarcodes, skuItemLinks } from "@/db/schema";
import {
	chooseEndpointForCapability,
	endpointToModelConfig,
	recordEndpointResult,
} from "@/lib/llm-routing";
import { logLlmDecision } from "@/lib/llm-observability";
import { normalizeProductName } from "@/lib/matching/normalize";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import { decideListwiseCascade } from "./ensemble";
import { processGroupWithLLM } from "./llm-call";
import { fetchMedianPrices } from "./price-fetch";
import type { CandidateGroup, GroupItem, ListwiseLLMResult } from "./types";

const log = createLogger("matching");

export interface RunListwiseSemanticClusteringOptions {
	limit?: number;
	minChains?: number;
	dryRun?: boolean;
	minPrimaryConfidence?: number;
}

export interface RunListwiseSemanticClusteringResult {
	processedGroups: number;
	skippedGroups: number;
	escalatedGroups: number;
	createdSkus: number;
	linkedItems: number;
}

interface BarcodeGroupRow {
	barcode: string;
	retailerItemId: string;
	rawName: string;
	normalizedName: string | null;
	brand: string | null;
	category: string | null;
	unit: string | null;
	unitQuantity: string | null;
	totalAmount: number | null;
	packAmount: number | null;
	containerType: string | null;
	chainSlug: string | null;
	embedding: unknown;
}

function parsePositiveInt(value: unknown, fallback: number): number {
	const parsed =
		typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEmbedding(value: unknown): number[] | null {
	if (Array.isArray(value)) {
		const numbers = value
			.map((entry) => {
				if (typeof entry === "number" && Number.isFinite(entry)) {
					return entry;
				}
				if (typeof entry === "string") {
					const parsed = Number(entry);
					return Number.isFinite(parsed) ? parsed : null;
				}
				return null;
			})
			.filter((entry): entry is number => entry != null);
		return numbers.length > 0 ? numbers : null;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return null;
		try {
			return parseEmbedding(JSON.parse(trimmed));
		} catch {
			return null;
		}
	}
	return null;
}

function normalizeNullableString(
	value: string | null | undefined,
): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableNumber(
	value: number | null | undefined,
): number | null {
	if (value == null || !Number.isFinite(value)) return null;
	return value;
}

function toGroupItem(row: BarcodeGroupRow): GroupItem {
	return {
		retailerItemId: row.retailerItemId,
		rawName: row.rawName,
		normalizedName:
			normalizeNullableString(row.normalizedName) ?? row.rawName.toLowerCase(),
		brand: normalizeNullableString(row.brand),
		category: normalizeNullableString(row.category),
		unit: normalizeNullableString(row.unit),
		unitQuantity: normalizeNullableString(row.unitQuantity),
		totalAmount: normalizeNullableNumber(row.totalAmount),
		packAmount: normalizeNullableNumber(row.packAmount),
		containerType: normalizeNullableString(row.containerType),
		chainSlug: normalizeNullableString(row.chainSlug),
		embedding: parseEmbedding(row.embedding),
	};
}

async function loadBarcodeGroups(params: {
	limit: number;
	minChains: number;
}): Promise<CandidateGroup[]> {
	const db = getDb();
	const result = await db.execute(sql`
		WITH barcode_clusters AS (
			SELECT
				rib.barcode,
				COUNT(DISTINCT ri.chain_slug) AS chain_count,
				COUNT(ri.id) AS item_count
			FROM retailer_item_barcodes rib
			JOIN retailer_items ri ON ri.id = rib.retailer_item_id
			WHERE ri.merged_into_id IS NULL
				AND rib.barcode_class NOT IN ('variable_weight', 'internal_code')
			GROUP BY rib.barcode
			HAVING COUNT(DISTINCT ri.chain_slug) >= ${params.minChains}
				AND COUNT(ri.id) >= 3
			ORDER BY COUNT(DISTINCT ri.chain_slug) DESC, COUNT(ri.id) DESC
			LIMIT ${params.limit}
		)
		SELECT
			rib.barcode AS barcode,
			ri.id AS retailer_item_id,
			ri.name AS raw_name,
			rif.normalized_name AS normalized_name,
			COALESCE(rif.extracted_brand, ri.brand) AS brand,
			COALESCE(rif.normalized_category, ri.category) AS category,
			COALESCE(rif.extracted_unit, ri.unit) AS unit,
			ri.unit_quantity AS unit_quantity,
			rif.total_amount AS total_amount,
			rif.pack_amount AS pack_amount,
			rif.container_type AS container_type,
			ri.chain_slug AS chain_slug,
			rif.embedding AS embedding
		FROM barcode_clusters bc
		JOIN retailer_item_barcodes rib ON rib.barcode = bc.barcode
		JOIN retailer_items ri ON ri.id = rib.retailer_item_id
		LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ri.merged_into_id IS NULL
		ORDER BY bc.barcode, ri.chain_slug
	`);

	const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
		barcode: string;
		retailer_item_id: string;
		raw_name: string;
		normalized_name: string | null;
		brand: string | null;
		category: string | null;
		unit: string | null;
		unit_quantity: string | null;
		total_amount: number | null;
		pack_amount: number | null;
		container_type: string | null;
		chain_slug: string | null;
		embedding: unknown;
	}>;

	const grouped = new Map<string, BarcodeGroupRow[]>();
	for (const row of rows) {
		if (!grouped.has(row.barcode)) {
			grouped.set(row.barcode, []);
		}
		grouped.get(row.barcode)?.push({
			barcode: row.barcode,
			retailerItemId: row.retailer_item_id,
			rawName: row.raw_name,
			normalizedName: row.normalized_name,
			brand: row.brand,
			category: row.category,
			unit: row.unit,
			unitQuantity: row.unit_quantity,
			totalAmount: row.total_amount,
			packAmount: row.pack_amount,
			containerType: row.container_type,
			chainSlug: row.chain_slug,
			embedding: row.embedding,
		});
	}

	const groups: CandidateGroup[] = [];
	for (const [barcode, items] of grouped.entries()) {
		const groupItems = items.map((row) => toGroupItem(row));
		const categories = new Set(
			groupItems
				.map((item) => item.category)
				.filter((c): c is string => c != null),
		);
		const brands = new Set(
			groupItems
				.map((item) => item.brand)
				.filter((b): b is string => b != null),
		);
		groups.push({
			groupId: `barcode_${barcode}`,
			seedKey: `barcode:${barcode}`,
			items: groupItems,
			category: categories.size === 1 ? Array.from(categories)[0] : null,
			brand: brands.size === 1 ? Array.from(brands)[0] : null,
		});
	}
	return groups;
}

function stableSkuKey(params: {
	canonicalName: string;
	brand: string | null;
	packAmount: number;
	containerType: string | null;
}): string {
	const name = normalizeProductName(params.canonicalName);
	const brand = normalizeProductName(params.brand ?? "");
	const container = normalizeProductName(params.containerType ?? "");
	return `v1|n:${name}|b:${brand}|p:${params.packAmount}|c:${container}`;
}

export async function persistAcceptedGrouping(params: {
	group: CandidateGroup;
	llm: ListwiseLLMResult;
	dryRun: boolean;
}): Promise<{ createdSkus: number; linkedItems: number }> {
	const db = getDb();
	const itemIds = params.group.items.map((item) => item.retailerItemId);

	// Preload barcodes for mapping context (barcode-seeded groups).
	const barcode = params.group.seedKey.startsWith("barcode:")
		? params.group.seedKey.slice("barcode:".length)
		: null;

	if (params.dryRun) {
		return { createdSkus: 0, linkedItems: 0 };
	}

	const result = await db.transaction(async (tx) => {
		// Avoid linking items that are already linked.
		const existingLinks = await tx
			.select({ retailerItemId: skuItemLinks.retailerItemId })
			.from(skuItemLinks)
			.where(inArray(skuItemLinks.retailerItemId, itemIds));
		const alreadyLinked = new Set(
			existingLinks.map((row) => row.retailerItemId),
		);

		const skuIdByKey = new Map<string, string>();
		let createdSkus = 0;
		let linkedItems = 0;

		for (const base of params.llm.clustering.baseProducts) {
			const baseSkuKey = stableSkuKey({
				canonicalName: base.canonicalName,
				brand: base.brand,
				packAmount: 1,
				containerType: null,
			});
			let baseSkuId = skuIdByKey.get(baseSkuKey) ?? null;
			if (!baseSkuId) {
				const [inserted] = await tx
					.insert(canonicalSkus)
					.values({
						canonicalName: base.canonicalName,
						brand: base.brand,
						productType: base.category,
						packAmount: 1,
						containerType: null,
						isBaseProduct: true,
						matchPolicy: "matchable",
						status: "draft",
						createdBy: null,
					})
					.returning({ id: canonicalSkus.id });
				baseSkuId = inserted.id;
				skuIdByKey.set(baseSkuKey, baseSkuId);
				createdSkus += 1;
			}

			for (const variant of base.packVariants) {
				const packAmount = variant.packCount ?? 1;
				const variantKey = stableSkuKey({
					canonicalName: `${base.canonicalName} ${variant.variantLabel}`.trim(),
					brand: base.brand,
					packAmount,
					containerType: variant.container,
				});
				let variantSkuId = skuIdByKey.get(variantKey) ?? null;
				if (!variantSkuId) {
					const [insertedVariant] = await tx
						.insert(canonicalSkus)
						.values({
							baseProductId: baseSkuId,
							canonicalName:
								`${base.canonicalName} ${variant.variantLabel}`.trim(),
							brand: base.brand,
							productType: base.category,
							packAmount,
							containerType: variant.container,
							isBaseProduct: false,
							matchPolicy: "matchable",
							status: "draft",
							createdBy: null,
						})
						.returning({ id: canonicalSkus.id });
					variantSkuId = insertedVariant.id;
					skuIdByKey.set(variantKey, variantSkuId);
					createdSkus += 1;
				}

				const linkRows = variant.itemIds
					.filter((id) => !alreadyLinked.has(id))
					.map((retailerItemId) => ({
						canonicalSkuId: variantSkuId,
						retailerItemId,
						linkType: "llm" as const,
						confidence: params.llm.clustering.confidence,
						createdBy: null,
						createdAt: new Date(),
					}));
				if (linkRows.length > 0) {
					const insertedLinks = await tx
						.insert(skuItemLinks)
						.values(linkRows)
						.onConflictDoNothing({ target: skuItemLinks.retailerItemId })
						.returning({ retailerItemId: skuItemLinks.retailerItemId });
					linkedItems += insertedLinks.length;
					for (const row of insertedLinks) {
						alreadyLinked.add(row.retailerItemId);
					}
				}
			}
		}

		// If this group is barcode seeded, ensure those items still have a barcode record.
		if (barcode) {
			await tx
				.select({ id: retailerItemBarcodes.id })
				.from(retailerItemBarcodes)
				.where(eq(retailerItemBarcodes.barcode, barcode))
				.limit(1);
		}

		return { createdSkus, linkedItems };
	});

	return result;
}

export async function runListwiseSemanticClustering(
	options: RunListwiseSemanticClusteringOptions = {},
): Promise<RunListwiseSemanticClusteringResult> {
	const limit =
		options.limit ?? parsePositiveInt(process.env.LISTWISE_CLUSTER_LIMIT, 25);
	const minChains =
		options.minChains ?? parsePositiveInt(process.env.LISTWISE_MIN_CHAINS, 2);
	const dryRun = options.dryRun ?? process.env.LISTWISE_DRY_RUN === "1";

	const primaryModel = endpointToModelConfig(
		await chooseEndpointForCapability("matching_primary"),
	);
	const secondaryModel = endpointToModelConfig(
		await chooseEndpointForCapability("matching_secondary"),
	);

	const groups = await loadBarcodeGroups({ limit, minChains });
	const allItemIds = groups.flatMap((group) =>
		group.items.map((item) => item.retailerItemId),
	);
	const prices = await fetchMedianPrices(allItemIds);

	let processedGroups = 0;
	let skippedGroups = 0;
	let escalatedGroups = 0;
	let createdSkus = 0;
	let linkedItems = 0;

	for (const group of groups) {
		processedGroups += 1;
		const groupItemCount = group.items.length;
		if (groupItemCount < 3) {
			skippedGroups += 1;
			continue;
		}

		log.info("Listwise clustering group", {
			groupId: group.groupId,
			seedKey: group.seedKey,
			itemCount: groupItemCount,
			primaryModel: primaryModel.id,
			secondaryModel: secondaryModel.id,
			dryRun,
		});

		const primaryStart = Date.now();
		const primary = await processGroupWithLLM(primaryModel, group, prices);
		await recordEndpointResult(primaryModel.id, {
			success: true,
			latencyMs: Date.now() - primaryStart,
		});
		const cascade = decideListwiseCascade({
			primary,
			primaryModel,
			secondaryModel,
			itemCount: groupItemCount,
			minPrimaryConfidence: options.minPrimaryConfidence,
		});

		await logLlmDecision({
			taskType: "listwise_cluster",
			input: {
				groupId: group.groupId,
				seedKey: group.seedKey,
				itemCount: groupItemCount,
				items: group.items.map((item) => ({
					id: item.retailerItemId,
					rawName: item.rawName,
					chainSlug: item.chainSlug,
				})),
			},
			output: {
				decision: cascade.shouldEscalate ? "escalate" : "accept",
				reason: cascade.reason,
				primary: {
					modelId: primary.modelId,
					provider: primary.provider,
					confidence: primary.clustering.confidence,
					baseProducts: primary.clustering.baseProducts.length,
					unclassified: primary.clustering.unclassified.length,
					missing: primary.clustering.missingItemIds.length,
					duplicates: primary.clustering.duplicateItemIds.length,
				},
			},
			modelId: primary.modelId,
			provider: primary.provider,
			endpointId: primary.modelId,
			verdict: cascade.shouldEscalate ? "ESCALATE" : "ACCEPT",
			confidence: primary.clustering.confidence,
			reasoning: cascade.reason,
			latencyMs: primary.totalLatencyMs,
			tokenCount: primary.tokenEstimates.total,
		});

		let accepted: ListwiseLLMResult;
		let secondary: ListwiseLLMResult | null = null;
		if (cascade.shouldEscalate) {
			escalatedGroups += 1;
			const secondaryStart = Date.now();
			secondary = await processGroupWithLLM(secondaryModel, group, prices);
			await recordEndpointResult(secondaryModel.id, {
				success: true,
				latencyMs: Date.now() - secondaryStart,
			});
			accepted = secondary;

			await logLlmDecision({
				taskType: "listwise_cluster_verify",
				input: {
					groupId: group.groupId,
					seedKey: group.seedKey,
					reason: cascade.reason,
				},
				output: {
					primary: {
						modelId: primary.modelId,
						confidence: primary.clustering.confidence,
						baseProducts: primary.clustering.baseProducts.length,
						unclassified: primary.clustering.unclassified.length,
					},
					secondary: {
						modelId: secondary.modelId,
						confidence: secondary.clustering.confidence,
						baseProducts: secondary.clustering.baseProducts.length,
						unclassified: secondary.clustering.unclassified.length,
					},
				},
				modelId: secondary.modelId,
				provider: secondary.provider,
				endpointId: secondary.modelId,
				verdict: "VERIFIED",
				confidence: secondary.clustering.confidence,
				reasoning: "Secondary model verification run",
				latencyMs: secondary.totalLatencyMs,
				tokenCount: secondary.tokenEstimates.total,
			});
		} else {
			accepted = primary;
		}

		const persisted = await persistAcceptedGrouping({
			group,
			llm: accepted,
			dryRun,
		});
		createdSkus += persisted.createdSkus;
		linkedItems += persisted.linkedItems;

		// Skip early if there is clearly no more work.
		if (processedGroups >= limit) {
			break;
		}
	}

	log.info("Listwise semantic clustering completed", {
		processedGroups,
		skippedGroups,
		escalatedGroups,
		createdSkus,
		linkedItems,
		dryRun,
	});

	return {
		processedGroups,
		skippedGroups,
		escalatedGroups,
		createdSkus,
		linkedItems,
	};
}
