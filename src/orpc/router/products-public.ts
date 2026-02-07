import { eq, inArray } from "drizzle-orm";
import * as z from "zod";
import {
	chains,
	clusterMembers,
	productClusters,
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

async function loadStorePrices(retailerItemIds: string[]) {
	const db = getDb();
	const clickhouse = getClickHouse();

	const links = await db
		.select({
			retailerItemId: retailerItems.id,
			chainSlug: retailerItems.chainSlug,
			chainName: chains.name,
		})
		.from(retailerItems)
		.leftJoin(chains, eq(retailerItems.chainSlug, chains.slug))
		.where(inArray(retailerItems.id, retailerItemIds));

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
	for (const link of links) {
		if (link.chainSlug && link.chainName) {
			chainNameMap.set(link.chainSlug, link.chainName);
		}
	}

	const storePrices = currentPriceRows.map((row) => {
		const currentPrice = parseNumber(row.current_price);
		const discountPrice = parseNumber(row.discount_price);
		return {
			retailerItemId: row.retailer_item_id,
			chainSlug: row.chain_slug,
			chainName: chainNameMap.get(row.chain_slug) ?? row.chain_slug,
			storeId: row.store_id,
			currentPrice,
			discountPrice,
			effectivePrice: discountPrice ?? currentPrice,
			lastSeenAt: row.last_seen_at,
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

async function getRetailerItemIdsForCluster(clusterId: string): Promise<string[]> {
	const db = getDb();
	const [cluster] = await db
		.select({ id: productClusters.id, clusterType: productClusters.clusterType })
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

export const getProductPrices = procedure
	.input(z.object({ productId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		const [cluster] = await db
			.select({
				id: productClusters.id,
				canonicalName: productClusters.canonicalName,
				clusterType: productClusters.clusterType,
			})
			.from(productClusters)
			.where(eq(productClusters.id, input.productId))
			.limit(1);

		if (!cluster) {
			throw new Error("Cluster not found");
		}

		const retailerItemIds = await getRetailerItemIdsForCluster(cluster.id);
		if (retailerItemIds.length === 0) {
			return {
				product: {
					id: cluster.id,
					name: cluster.canonicalName ?? "Cluster",
					category: cluster.clusterType,
					unit: null,
					unitQuantity: null,
					brand: null,
					imageUrl: null,
				},
				storePrices: [],
				priceHistory: [],
			};
		}

		const { storePrices, priceHistory } = await loadStorePrices(retailerItemIds);
		return {
			product: {
				id: cluster.id,
				name: cluster.canonicalName ?? "Cluster",
				category: cluster.clusterType,
				unit: null,
				unitQuantity: null,
				brand: null,
				imageUrl: null,
			},
			storePrices,
			priceHistory,
		};
	});
