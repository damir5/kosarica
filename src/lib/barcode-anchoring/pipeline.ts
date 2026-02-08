import { eq, inArray, isNull, sql } from "drizzle-orm";
import {
	barcodeSkuMappings,
	canonicalSkus,
	retailerItemBarcodes,
	retailerItemFeatures,
	retailerItems,
	skuItemLinks,
} from "@/db/schema";
import { logCatalogEvent } from "@/lib/catalog-events";
import { getLatestEffectivePricesByItemId } from "@/lib/clickhouse/latest-prices";
import { chunk } from "@/lib/collections/chunk";
import { logLlmDecision } from "@/lib/llm-observability";
import { median } from "@/lib/math/median";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import { classifyBarcode, groupByBarcode } from "./matching";
import { autoLinkEligibility, priorityScore } from "./scoring";
import type {
	BarcodeClass,
	BarcodeCluster,
	BarcodeSourceRow,
	BuildBarcodeClusterQueueOptions,
	ProcessBarcodeClustersOptions,
	ProcessBarcodeClustersResult,
} from "./types";

const log = createLogger("matching");
const BARCODE_CLASS_CROSS_CHAIN_BLOCKLIST = new Set<BarcodeClass>([
	"variable_weight",
	"internal_code",
]);

class BarcodeMappingConflictError extends Error {
	constructor(barcode: string) {
		super(`Barcode mapping already exists for barcode ${barcode}`);
		this.name = "BarcodeMappingConflictError";
	}
}

function normalizeCategory(category: string | null): string | null {
	if (!category) {
		return null;
	}
	const trimmed = category.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : null;
}

function computePriceVariance(prices: number[]): number | null {
	if (prices.length < 2) {
		return null;
	}
	const valid = prices.filter((price) => Number.isFinite(price) && price > 0);
	if (valid.length < 2) {
		return null;
	}
	const med = median(valid);
	if (med == null || med <= 0) {
		return null;
	}
	const max = Math.max(...valid);
	const min = Math.min(...valid);
	return (max - min) / med;
}

function computeCategoryAgreement(items: BarcodeCluster["items"]): number {
	if (items.length === 0) {
		return 0;
	}
	const counts = new Map<string, number>();
	for (const item of items) {
		const category = normalizeCategory(item.category);
		if (!category) {
			continue;
		}
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	if (counts.size === 0) {
		return 0;
	}
	const maxCount = Math.max(...counts.values());
	return maxCount / items.length;
}

function selectCanonicalName(items: BarcodeCluster["items"]): string {
	const byName = new Map<string, number>();
	for (const item of items) {
		const key = item.name.trim();
		if (key.length === 0) {
			continue;
		}
		byName.set(key, (byName.get(key) ?? 0) + 1);
	}
	const ranked = Array.from(byName.entries()).sort((a, b) => {
		if (b[1] !== a[1]) {
			return b[1] - a[1];
		}
		return b[0].length - a[0].length;
	});
	return ranked[0]?.[0] ?? "Unnamed canonical SKU";
}

async function loadSourceRows(): Promise<BarcodeSourceRow[]> {
	const db = getDb();
	return await db
		.select({
			barcode: retailerItemBarcodes.barcode,
			barcodeClass: retailerItemBarcodes.barcodeClass,
			retailerItemId: retailerItems.id,
			chainSlug: retailerItems.chainSlug,
			name: retailerItems.name,
			category: retailerItemFeatures.normalizedCategory,
		})
		.from(retailerItemBarcodes)
		.innerJoin(
			retailerItems,
			eq(retailerItemBarcodes.retailerItemId, retailerItems.id),
		)
		.leftJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.where(isNull(retailerItems.mergedIntoId));
}

async function persistBarcodeClassifications(
	rows: BarcodeSourceRow[],
): Promise<void> {
	const db = getDb();
	const desiredByBarcode = new Map<string, BarcodeClass>();
	const existingByBarcode = new Map<string, Set<string>>();

	for (const row of rows) {
		const desired = classifyBarcode(row.barcode);
		desiredByBarcode.set(row.barcode, desired);
		if (!existingByBarcode.has(row.barcode)) {
			existingByBarcode.set(row.barcode, new Set());
		}
		const existingClass = row.barcodeClass ?? "unknown";
		existingByBarcode.get(row.barcode)?.add(existingClass);
	}

	for (const [barcode, desired] of desiredByBarcode.entries()) {
		const existing = existingByBarcode.get(barcode);
		if (existing && existing.size === 1 && existing.has(desired)) {
			continue;
		}
		await db
			.update(retailerItemBarcodes)
			.set({ barcodeClass: desired })
			.where(eq(retailerItemBarcodes.barcode, barcode));
	}
}

async function loadLatestPrices(
	itemIds: string[],
): Promise<Map<string, number>> {
	return await getLatestEffectivePricesByItemId(itemIds);
}

async function loadMappedBarcodes(
	barcodes: string[],
): Promise<Set<string>> {
	if (barcodes.length === 0) {
		return new Set();
	}
	const db = getDb();
	const mapped = new Set<string>();
	for (const batch of chunk(barcodes, 5000)) {
		const rows = await db
			.select({ barcode: barcodeSkuMappings.barcode })
			.from(barcodeSkuMappings)
			.where(inArray(barcodeSkuMappings.barcode, batch));
		for (const row of rows) {
			mapped.add(row.barcode);
		}
	}
	return mapped;
}

async function autoLinkCluster(
	cluster: BarcodeCluster,
): Promise<{
	skuId: string;
	mappingId: string;
	linkedItemIds: string[];
	skippedItemIds: string[];
}> {
	const db = getDb();
	return await db.transaction(async (tx) => {
		const [sku] = await tx
			.insert(canonicalSkus)
			.values({
				canonicalName: selectCanonicalName(cluster.items),
				isBaseProduct: true,
				matchPolicy: "matchable",
				status: "active",
				createdBy: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning({ id: canonicalSkus.id });

		const [mapping] = await tx
			.insert(barcodeSkuMappings)
			.values({
				barcode: cluster.barcode,
				canonicalSkuId: sku.id,
				confidence: 0.98,
				source: "barcode_cluster",
				createdBy: null,
				createdAt: new Date(),
			})
			.onConflictDoNothing({ target: barcodeSkuMappings.barcode })
			.returning({ id: barcodeSkuMappings.id });
		if (!mapping) {
			throw new BarcodeMappingConflictError(cluster.barcode);
		}

		const links = cluster.items.map((item) => ({
			canonicalSkuId: sku.id,
			retailerItemId: item.retailerItemId,
			linkType: "barcode" as const,
			confidence: 0.98,
			createdBy: null,
			createdAt: new Date(),
		}));
			const insertedLinks =
				links.length === 0
					? []
					: await tx
							.insert(skuItemLinks)
							.values(links)
							.onConflictDoNothing({ target: skuItemLinks.retailerItemId })
							.returning({ retailerItemId: skuItemLinks.retailerItemId });
		const linkedItemIds = insertedLinks.map((row) => row.retailerItemId);
		const linkedItemSet = new Set(linkedItemIds);
		const skippedItemIds = cluster.items
			.map((item) => item.retailerItemId)
			.filter((retailerItemId) => !linkedItemSet.has(retailerItemId));

		return {
			skuId: sku.id,
			mappingId: mapping.id,
			linkedItemIds,
			skippedItemIds,
		};
	});
}

export async function buildBarcodeClusterQueue(
	options: BuildBarcodeClusterQueueOptions = {},
): Promise<BarcodeCluster[]> {
	const minChains = options.minChains ?? 2;
	const sourceRows = await loadSourceRows();
	await persistBarcodeClassifications(sourceRows);
	const clusters = Array.from(groupByBarcode(sourceRows).values());
	const itemIds = clusters.flatMap((cluster) =>
		cluster.items.map((item) => item.retailerItemId),
	);
	const pricesByItem = await loadLatestPrices(itemIds);

	const queue: BarcodeCluster[] = [];
	for (const cluster of clusters) {
		if (BARCODE_CLASS_CROSS_CHAIN_BLOCKLIST.has(cluster.barcodeClass)) {
			continue;
		}

		cluster.chainCount = new Set(
			cluster.items
				.map((item) => item.chainSlug)
				.filter((chain): chain is string => chain != null),
		).size;
		cluster.itemCount = cluster.items.length;
		if (cluster.chainCount < minChains) {
			continue;
		}

		cluster.categoryAgreement = computeCategoryAgreement(cluster.items);
		cluster.priceVariance = computePriceVariance(
			cluster.items
				.map((item) => pricesByItem.get(item.retailerItemId) ?? null)
				.filter((price): price is number => price != null),
		);
		cluster.priorityScore = priorityScore(cluster);
		queue.push(cluster);
	}

	queue.sort((a, b) => b.priorityScore - a.priorityScore);
	if (options.limit && options.limit > 0) {
		return queue.slice(0, options.limit);
	}
	return queue;
}

export async function processBarcodeClusters(
	options: ProcessBarcodeClustersOptions = {},
): Promise<ProcessBarcodeClustersResult> {
	const queue = await buildBarcodeClusterQueue({
		limit: options.limit,
		minChains: options.minChains ?? 2,
	});

	const mappedBarcodes = await loadMappedBarcodes(queue.map((cluster) => cluster.barcode));
	let processed = 0;
	let autoLinked = 0;
	let triageQueued = 0;
	let skipped = 0;

	for (const cluster of queue) {
		processed += 1;
		if (mappedBarcodes.has(cluster.barcode)) {
			skipped += 1;
			continue;
		}

		const eligible = autoLinkEligibility(cluster);
		await logLlmDecision({
			taskType: "barcode_assign",
			input: {
				barcode: cluster.barcode,
				barcodeClass: cluster.barcodeClass,
				chainCount: cluster.chainCount,
				itemCount: cluster.itemCount,
				categoryAgreement: cluster.categoryAgreement,
				priceVariance: cluster.priceVariance,
				priorityScore: cluster.priorityScore,
				items: cluster.items,
			},
			output: {
				decision: eligible ? "auto_link" : "triage",
			},
			modelId: "heuristic",
			provider: "rule-engine",
			verdict: eligible ? "AUTO_LINK" : "TRIAGE",
			confidence: eligible ? 0.98 : 0.5,
			reasoning: eligible
				? "Barcode observed in 3+ chains with category alignment and bounded price variance"
				: "Cluster needs review due to precision guardrails",
		});

		if (!eligible) {
			triageQueued += 1;
			continue;
		}

		if (options.dryRun) {
			autoLinked += 1;
			continue;
		}

		let linked: Awaited<ReturnType<typeof autoLinkCluster>>;
		try {
			linked = await autoLinkCluster(cluster);
		} catch (error) {
			if (error instanceof BarcodeMappingConflictError) {
				skipped += 1;
				log.warn("Skipped auto-link cluster due to mapping race", {
					barcode: cluster.barcode,
				});
				continue;
			}
			throw error;
		}
		autoLinked += 1;

		if (linked.skippedItemIds.length > 0) {
			log.warn("Auto-link skipped already-linked retailer items", {
				barcode: cluster.barcode,
				skuId: linked.skuId,
				skippedItemIds: linked.skippedItemIds,
			});
		}
		await logCatalogEvent({
			eventType: "sku_created",
			entityType: "canonical_sku",
			entityId: linked.skuId,
			actorId: null,
			payload: {
				barcode: cluster.barcode,
				itemCount: cluster.itemCount,
				chainCount: cluster.chainCount,
				linkedItemIds: linked.linkedItemIds,
				skippedItemIds: linked.skippedItemIds,
			},
		});

		await logCatalogEvent({
			eventType: "barcode_mapped",
			entityType: "barcode_mapping",
			entityId: linked.mappingId,
			actorId: null,
			payload: {
				barcode: cluster.barcode,
				skuId: linked.skuId,
			},
		});

		for (const retailerItemId of linked.linkedItemIds) {
			await logCatalogEvent({
				eventType: "item_linked",
				entityType: "sku_item_link",
				entityId: retailerItemId,
				actorId: null,
				payload: {
					skuId: linked.skuId,
					retailerItemId,
					linkType: "barcode",
				},
			});
		}
	}

	log.info("Barcode anchoring run completed", {
		processed,
		autoLinked,
		triageQueued,
		skipped,
		dryRun: options.dryRun ?? false,
	});

	return {
		processed,
		autoLinked,
		triageQueued,
		skipped,
	};
}

export async function refreshBarcodeTriageQueue(): Promise<void> {
	const db = getDb();
	await db.execute(sql`REFRESH MATERIALIZED VIEW barcode_triage_queue`);
}
