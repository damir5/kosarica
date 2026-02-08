import { eq, inArray } from "drizzle-orm";
import * as z from "zod";
import {
	chains,
	clusterMembers,
	productClusters,
	retailerItemFeatures,
	retailerItems,
} from "@/db/schema";
import { getClickHouse, parseNumber } from "@/lib/clickhouse";
import { getDb } from "@/utils/bindings";
import { procedure } from "../base";

type ClickHousePriceHistoryRow = {
	target_date: string;
	chain_slug: string;
	store_id: string;
	price_cents: number | string | null;
	discount_price_cents: number | string | null;
};

type ClickHouseCurrentPriceRow = {
	retailer_item_id: string;
	chain_slug: string;
	store_id: string;
	current_price: number | string | null;
	discount_price: number | string | null;
	last_seen_at: string;
};

type ProductPayload = {
	id: string;
	name: string;
	category: string;
	unit: string | null;
	unitQuantity: string | null;
	brand: string | null;
	imageUrl: string | null;
};

type ResolvedProduct = {
	product: ProductPayload;
	retailerItemIds: string[];
};

function buildEmptyResponse(product: ProductPayload) {
	return {
		product,
		storePrices: [],
		priceHistory: [],
	};
}

async function loadStorePrices(retailerItemIds: string[]) {
	const db = getDb();
	const clickhouse = getClickHouse();

	const links = await db
		.select({
			retailerItemId: retailerItems.id,
			chainSlug: retailerItems.chainSlug,
			chainName: chains.name,
			itemName: retailerItems.name,
		})
		.from(retailerItems)
		.leftJoin(chains, eq(retailerItems.chainSlug, chains.slug))
		.where(inArray(retailerItems.id, retailerItemIds));

	const features = await db
		.select({
			retailerItemId: retailerItemFeatures.retailerItemId,
			extractedUnit: retailerItemFeatures.extractedUnit,
			totalAmount: retailerItemFeatures.totalAmount,
		})
		.from(retailerItemFeatures)
		.where(inArray(retailerItemFeatures.retailerItemId, retailerItemIds));

	const currentPriceRows = await clickhouse.query<ClickHouseCurrentPriceRow>(
		`SELECT
			retailer_item_id,
			chain_slug,
			store_id,
			argMax(price_cents, target_date) AS current_price,
			argMax(discount_price_cents, target_date) AS discount_price,
			max(target_date) AS last_seen_at
		FROM prices
		WHERE retailer_item_id IN ({itemIds:Array(String)})
			AND target_date <= today()
		GROUP BY retailer_item_id, chain_slug, store_id`,
		{ itemIds: retailerItemIds },
	);

	const chainNameMap = new Map<string, string>();
	const itemNameMap = new Map<string, string>();
	for (const link of links) {
		if (link.chainSlug && link.chainName) {
			chainNameMap.set(link.chainSlug, link.chainName);
		}
		if (link.retailerItemId && link.itemName) {
			itemNameMap.set(link.retailerItemId, link.itemName);
		}
	}

	const featureMap = new Map<
		string,
		{ extractedUnit: string | null; totalAmount: number | null }
	>();
	for (const f of features) {
		featureMap.set(f.retailerItemId, {
			extractedUnit: f.extractedUnit,
			totalAmount: f.totalAmount,
		});
	}

	const storePrices = currentPriceRows.map((row) => {
		const currentPrice = parseNumber(row.current_price);
		const discountPrice = parseNumber(row.discount_price);
		const effectivePrice = discountPrice ?? currentPrice;
		const feat = featureMap.get(row.retailer_item_id);
		const unitLabel = feat?.extractedUnit ?? null;
		const totalAmount = feat?.totalAmount ?? null;
		const unitPriceCents =
			effectivePrice != null && totalAmount != null && totalAmount > 0
				? Math.round(effectivePrice / totalAmount)
				: null;
		return {
			retailerItemId: row.retailer_item_id,
			chainSlug: row.chain_slug,
			chainName: chainNameMap.get(row.chain_slug) ?? row.chain_slug,
			storeId: row.store_id,
			currentPrice,
			discountPrice,
			effectivePrice,
			lastSeenAt: row.last_seen_at,
			itemName: itemNameMap.get(row.retailer_item_id) ?? "",
			unitPriceCents,
			unitLabel,
		};
	});

	const historyRows = await clickhouse.query<ClickHousePriceHistoryRow>(
		`SELECT
			target_date,
			chain_slug,
			store_id,
			price_cents,
			discount_price_cents
		FROM prices
		WHERE retailer_item_id IN ({itemIds:Array(String)})
			AND target_date >= today() - 90
			AND target_date <= today()
		ORDER BY target_date ASC`,
		{ itemIds: retailerItemIds },
	);

	const dateMap = new Map<string, number>();
	for (const row of historyRows) {
		const price =
			parseNumber(row.discount_price_cents) ?? parseNumber(row.price_cents);
		if (price == null) {
			continue;
		}
		const eur = price / 100;
		const current = dateMap.get(row.target_date);
		if (current == null || eur < current) {
			dateMap.set(row.target_date, eur);
		}
	}

	const priceHistory = Array.from(dateMap.entries())
		.map(([date, value]) => ({ date, value }))
		.sort((a, b) => a.date.localeCompare(b.date));

	return { storePrices, priceHistory };
}

async function getRetailerItemIdsForCluster(
	clusterId: string,
): Promise<string[]> {
	const db = getDb();
	const [cluster] = await db
		.select({
			id: productClusters.id,
			clusterType: productClusters.clusterType,
		})
		.from(productClusters)
		.where(eq(productClusters.id, clusterId))
		.limit(1);

	if (!cluster) {
		return [];
	}

	if (cluster.clusterType === "variant") {
		const members = await db
			.select({ retailerItemId: clusterMembers.retailerItemId })
			.from(clusterMembers)
			.where(eq(clusterMembers.clusterId, clusterId));
		return members
			.map((member) => member.retailerItemId)
			.filter((id): id is string => id != null);
	}

	const baseMembers = await db
		.select({ variantClusterId: clusterMembers.variantClusterId })
		.from(clusterMembers)
		.where(eq(clusterMembers.clusterId, clusterId));

	const variantClusterIds = baseMembers
		.map((member) => member.variantClusterId)
		.filter((id): id is string => id != null);

	if (variantClusterIds.length === 0) {
		return [];
	}

	const variantItems = await db
		.select({ retailerItemId: clusterMembers.retailerItemId })
		.from(clusterMembers)
		.where(inArray(clusterMembers.clusterId, variantClusterIds));

	return variantItems
		.map((member) => member.retailerItemId)
		.filter((id): id is string => id != null);
}

async function buildClusterProductPayload(cluster: {
	id: string;
	canonicalName: string | null;
	clusterType: string;
	representativeRetailerItemId: string | null;
}): Promise<ProductPayload> {
	const base: ProductPayload = {
		id: cluster.id,
		name: cluster.canonicalName ?? "Cluster",
		category: cluster.clusterType,
		unit: null,
		unitQuantity: null,
		brand: null,
		imageUrl: null,
	};

	if (!cluster.representativeRetailerItemId) {
		return base;
	}

	const db = getDb();
	const [item] = await db
		.select({
			brand: retailerItems.brand,
			imageUrl: retailerItems.imageUrl,
		})
		.from(retailerItems)
		.where(eq(retailerItems.id, cluster.representativeRetailerItemId))
		.limit(1);

	const [feat] = await db
		.select({
			extractedUnit: retailerItemFeatures.extractedUnit,
			totalAmount: retailerItemFeatures.totalAmount,
		})
		.from(retailerItemFeatures)
		.where(
			eq(
				retailerItemFeatures.retailerItemId,
				cluster.representativeRetailerItemId,
			),
		)
		.limit(1);

	if (item) {
		base.brand = item.brand;
		base.imageUrl = item.imageUrl;
	}
	if (feat) {
		base.unit = feat.extractedUnit;
		base.unitQuantity =
			feat.totalAmount != null ? String(feat.totalAmount) : null;
	}

	return base;
}

async function resolveProduct(
	inputId: string,
): Promise<ResolvedProduct | null> {
	const db = getDb();

	const [directCluster] = await db
		.select({
			id: productClusters.id,
			canonicalName: productClusters.canonicalName,
			clusterType: productClusters.clusterType,
			representativeRetailerItemId:
				productClusters.representativeRetailerItemId,
		})
		.from(productClusters)
		.where(eq(productClusters.id, inputId))
		.limit(1);

	if (directCluster) {
		return {
			product: await buildClusterProductPayload(directCluster),
			retailerItemIds: await getRetailerItemIdsForCluster(directCluster.id),
		};
	}

	const [clusterMembership] = await db
		.select({ clusterId: clusterMembers.clusterId })
		.from(clusterMembers)
		.where(eq(clusterMembers.retailerItemId, inputId))
		.limit(1);

	if (clusterMembership) {
		const [clusterFromItem] = await db
			.select({
				id: productClusters.id,
				canonicalName: productClusters.canonicalName,
				clusterType: productClusters.clusterType,
				representativeRetailerItemId:
					productClusters.representativeRetailerItemId,
			})
			.from(productClusters)
			.where(eq(productClusters.id, clusterMembership.clusterId))
			.limit(1);

		if (clusterFromItem) {
			return {
				product: await buildClusterProductPayload(clusterFromItem),
				retailerItemIds: await getRetailerItemIdsForCluster(clusterFromItem.id),
			};
		}
	}

	const [retailerItem] = await db
		.select({
			id: retailerItems.id,
			name: retailerItems.name,
			category: retailerItems.category,
			unit: retailerItems.unit,
			unitQuantity: retailerItems.unitQuantity,
			brand: retailerItems.brand,
			imageUrl: retailerItems.imageUrl,
		})
		.from(retailerItems)
		.where(eq(retailerItems.id, inputId))
		.limit(1);

	if (!retailerItem) {
		return null;
	}

	return {
		product: {
			id: retailerItem.id,
			name: retailerItem.name,
			category: retailerItem.category ?? "item",
			unit: retailerItem.unit,
			unitQuantity: retailerItem.unitQuantity,
			brand: retailerItem.brand,
			imageUrl: retailerItem.imageUrl,
		},
		retailerItemIds: [retailerItem.id],
	};
}

export const getProductPrices = procedure
	.input(z.object({ productId: z.string() }))
	.handler(async ({ input }) => {
		const resolvedProduct = await resolveProduct(input.productId);
		if (!resolvedProduct) {
			throw new Error("Product not found");
		}

		const { product, retailerItemIds } = resolvedProduct;
		if (retailerItemIds.length === 0) {
			return buildEmptyResponse(product);
		}

		const { storePrices, priceHistory } =
			await loadStorePrices(retailerItemIds);
		return {
			product,
			storePrices,
			priceHistory,
		};
	});

function buildPackDescription(feat: {
	isMultipack: boolean;
	packAmount: number;
	unitAmount: number | null;
	extractedUnit: string | null;
	containerType: string | null;
}): string {
	const unit = feat.extractedUnit ?? "";
	const amount = feat.unitAmount != null ? feat.unitAmount : null;
	const amountStr = amount != null ? String(amount).replace(/\.0$/, "") : "";

	let desc: string;
	if (feat.isMultipack && feat.packAmount > 1 && amountStr) {
		desc = `${feat.packAmount}x${amountStr}${unit}`;
	} else if (amountStr) {
		desc = `${amountStr}${unit}`;
	} else {
		return "";
	}

	if (feat.containerType) {
		desc += ` ${feat.containerType}`;
	}
	return desc;
}

type ClickHouseBestPriceRow = {
	retailer_item_id: string;
	best_price: number | string | null;
	chain_slug: string;
};

export const getSimilarVariants = procedure
	.input(z.object({ productId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Step 1: Resolve productId → variant cluster ID
		let variantClusterId: string | null = null;

		const [directCluster] = await db
			.select({
				id: productClusters.id,
				clusterType: productClusters.clusterType,
			})
			.from(productClusters)
			.where(eq(productClusters.id, input.productId))
			.limit(1);

		if (directCluster) {
			if (directCluster.clusterType === "variant") {
				variantClusterId = directCluster.id;
			} else {
				// It's a base cluster — no "self" variant to exclude, return variants directly
				return getSiblingsForBase(directCluster.id, null);
			}
		} else {
			// Check if it's a retailer item belonging to a variant cluster
			const [membership] = await db
				.select({ clusterId: clusterMembers.clusterId })
				.from(clusterMembers)
				.where(eq(clusterMembers.retailerItemId, input.productId))
				.limit(1);

			if (membership) {
				const [cluster] = await db
					.select({
						id: productClusters.id,
						clusterType: productClusters.clusterType,
					})
					.from(productClusters)
					.where(eq(productClusters.id, membership.clusterId))
					.limit(1);

				if (cluster?.clusterType === "variant") {
					variantClusterId = cluster.id;
				}
			}
		}

		if (!variantClusterId) {
			return [];
		}

		// Step 2: Find parent base cluster
		const [parentMember] = await db
			.select({ clusterId: clusterMembers.clusterId })
			.from(clusterMembers)
			.where(eq(clusterMembers.variantClusterId, variantClusterId))
			.limit(1);

		if (!parentMember) {
			return [];
		}

		return getSiblingsForBase(parentMember.clusterId, variantClusterId);
	});

async function getSiblingsForBase(
	baseClusterId: string,
	excludeVariantId: string | null,
) {
	const db = getDb();
	const clickhouse = getClickHouse();

	// Get sibling variant clusters (excluding self)
	const siblingMembers = await db
		.select({ variantClusterId: clusterMembers.variantClusterId })
		.from(clusterMembers)
		.where(eq(clusterMembers.clusterId, baseClusterId));

	const siblingIds = siblingMembers
		.map((m) => m.variantClusterId)
		.filter((id): id is string => id != null && id !== excludeVariantId);

	if (siblingIds.length === 0) {
		return [];
	}

	// Get cluster details
	const siblings = await db
		.select({
			id: productClusters.id,
			canonicalName: productClusters.canonicalName,
			representativeRetailerItemId:
				productClusters.representativeRetailerItemId,
		})
		.from(productClusters)
		.where(inArray(productClusters.id, siblingIds));

	// Get all retailer items for all sibling clusters
	const siblingItemMembers = await db
		.select({
			clusterId: clusterMembers.clusterId,
			retailerItemId: clusterMembers.retailerItemId,
		})
		.from(clusterMembers)
		.where(inArray(clusterMembers.clusterId, siblingIds));

	const allItemIds = siblingItemMembers
		.map((m) => m.retailerItemId)
		.filter((id): id is string => id != null);

	if (allItemIds.length === 0) {
		return [];
	}

	// Map items to their cluster
	const itemToCluster = new Map<string, string>();
	for (const m of siblingItemMembers) {
		if (m.retailerItemId) {
			itemToCluster.set(m.retailerItemId, m.clusterId);
		}
	}

	// Two-step query: first get latest price per item+store, then pick the best per item
	const priceRows = await clickhouse.query<ClickHouseBestPriceRow>(
		`SELECT
			retailer_item_id,
			min(effective_price) AS best_price,
			argMin(chain_slug, effective_price) AS chain_slug
		FROM (
			SELECT
				retailer_item_id,
				chain_slug,
				if(argMax(discount_price_cents, target_date) > 0,
					argMax(discount_price_cents, target_date),
					argMax(price_cents, target_date)
				) AS effective_price
			FROM prices
			WHERE retailer_item_id IN ({itemIds:Array(String)})
				AND target_date >= today() - 7
				AND target_date <= today()
			GROUP BY retailer_item_id, chain_slug, store_id
		)
		GROUP BY retailer_item_id`,
		{ itemIds: allItemIds },
	);

	// Build best price per cluster
	const clusterBestPrice = new Map<
		string,
		{ priceCents: number; chainSlug: string }
	>();
	for (const row of priceRows) {
		const price = parseNumber(row.best_price);
		if (price == null) continue;
		const clusterId = itemToCluster.get(row.retailer_item_id);
		if (!clusterId) continue;
		const existing = clusterBestPrice.get(clusterId);
		if (!existing || price < existing.priceCents) {
			clusterBestPrice.set(clusterId, {
				priceCents: price,
				chainSlug: row.chain_slug,
			});
		}
	}

	// Get features for representative items
	const repItemIds = siblings
		.map((s) => s.representativeRetailerItemId)
		.filter((id): id is string => id != null);

	const repFeatures =
		repItemIds.length > 0
			? await db
					.select({
						retailerItemId: retailerItemFeatures.retailerItemId,
						extractedUnit: retailerItemFeatures.extractedUnit,
						totalAmount: retailerItemFeatures.totalAmount,
						isMultipack: retailerItemFeatures.isMultipack,
						packAmount: retailerItemFeatures.packAmount,
						unitAmount: retailerItemFeatures.unitAmount,
						containerType: retailerItemFeatures.containerType,
					})
					.from(retailerItemFeatures)
					.where(inArray(retailerItemFeatures.retailerItemId, repItemIds))
			: [];

	const repFeatureMap = new Map<string, (typeof repFeatures)[number]>();
	for (const f of repFeatures) {
		repFeatureMap.set(f.retailerItemId, f);
	}

	// Get image URLs for representative items
	const repItems =
		repItemIds.length > 0
			? await db
					.select({ id: retailerItems.id, imageUrl: retailerItems.imageUrl })
					.from(retailerItems)
					.where(inArray(retailerItems.id, repItemIds))
			: [];

	const repImageMap = new Map<string, string | null>();
	for (const item of repItems) {
		repImageMap.set(item.id, item.imageUrl);
	}

	// Build result
	const results = siblings
		.filter((s) => clusterBestPrice.has(s.id))
		.map((s) => {
			// biome-ignore lint/style/noNonNullAssertion: filtered by .has() above
			const best = clusterBestPrice.get(s.id)!;
			const feat = s.representativeRetailerItemId
				? repFeatureMap.get(s.representativeRetailerItemId)
				: undefined;
			const totalAmount = feat?.totalAmount ?? null;
			const unitLabel = feat?.extractedUnit ?? null;
			const unitPriceCents =
				totalAmount != null && totalAmount > 0
					? Math.round(best.priceCents / totalAmount)
					: null;
			return {
				id: s.id,
				name: s.canonicalName ?? "Variant",
				packDescription: feat ? buildPackDescription(feat) : "",
				bestPriceCents: best.priceCents,
				unitPriceCents,
				unitLabel,
				totalAmount,
				bestChainSlug: best.chainSlug,
				imageUrl: s.representativeRetailerItemId
					? (repImageMap.get(s.representativeRetailerItemId) ?? null)
					: null,
			};
		})
		.sort((a, b) => {
			// Sort by unit price ascending (best value first), nulls last
			if (a.unitPriceCents != null && b.unitPriceCents != null) {
				return a.unitPriceCents - b.unitPriceCents;
			}
			if (a.unitPriceCents != null) return -1;
			if (b.unitPriceCents != null) return 1;
			return a.bestPriceCents - b.bestPriceCents;
		});

	return results;
}
