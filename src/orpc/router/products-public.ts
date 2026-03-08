import { eq, inArray } from "drizzle-orm";
import * as z from "zod";
import {
	canonicalSkus,
	chains,
	retailerItemFeatures,
	retailerItems,
	skuItemLinks,
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

type ClickHouseBestPriceRow = {
	retailer_item_id: string;
	best_price: number | string | null;
	chain_slug: string;
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

function buildStorePrices(
	priceRows: ClickHouseCurrentPriceRow[],
	chainNameMap: Map<string, string>,
	itemNameMap: Map<string, string>,
	featureMap: Map<
		string,
		{ extractedUnit: string | null; totalAmount: number | null }
	>,
) {
	return priceRows.map((row) => {
		const currentPrice = parseNumber(row.current_price);
		const discountPrice = parseNumber(row.discount_price);
		const effectivePrice = discountPrice ?? currentPrice;
		const feature = featureMap.get(row.retailer_item_id);
		const unitLabel = feature?.extractedUnit ?? null;
		const totalAmount = feature?.totalAmount ?? null;
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
			price_cents AS current_price,
			discount_price_cents AS discount_price,
			target_date AS last_seen_at
		FROM prices_current FINAL
		WHERE retailer_item_id IN ({itemIds:Array(String)})`,
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
	for (const feature of features) {
		featureMap.set(feature.retailerItemId, {
			extractedUnit: feature.extractedUnit,
			totalAmount: feature.totalAmount,
		});
	}

	let storePrices = buildStorePrices(
		currentPriceRows,
		chainNameMap,
		itemNameMap,
		featureMap,
	);

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
		const existing = dateMap.get(row.target_date);
		if (existing == null || eur < existing) {
			dateMap.set(row.target_date, eur);
		}
	}

	const priceHistory = Array.from(dateMap.entries())
		.map(([date, value]) => ({ date, value }))
		.sort((a, b) => a.date.localeCompare(b.date));

	// Fallback: if prices_current returned no rows but we have history data,
	// derive current prices from the latest entries in the raw prices table.
	if (storePrices.length === 0 && historyRows.length > 0) {
		const fallbackRows = await clickhouse.query<ClickHouseCurrentPriceRow>(
			`SELECT
				retailer_item_id,
				chain_slug,
				store_id,
				argMax(price_cents, target_date) AS current_price,
				argMax(discount_price_cents, target_date) AS discount_price,
				max(target_date) AS last_seen_at
			FROM prices
			WHERE retailer_item_id IN ({itemIds:Array(String)})
				AND target_date >= today() - 30
				AND target_date <= today()
			GROUP BY retailer_item_id, chain_slug, store_id`,
			{ itemIds: retailerItemIds },
		);

		storePrices = buildStorePrices(
			fallbackRows,
			chainNameMap,
			itemNameMap,
			featureMap,
		);
	}

	return { storePrices, priceHistory };
}

async function getItemIdsForSku(skuId: string): Promise<string[]> {
	const db = getDb();
	const [sku] = await db
		.select({
			id: canonicalSkus.id,
			isBaseProduct: canonicalSkus.isBaseProduct,
		})
		.from(canonicalSkus)
		.where(eq(canonicalSkus.id, skuId))
		.limit(1);
	if (!sku) {
		return [];
	}

	const targetSkuIds = new Set<string>([skuId]);
	if (sku.isBaseProduct) {
		const childRows = await db
			.select({ id: canonicalSkus.id })
			.from(canonicalSkus)
			.where(eq(canonicalSkus.baseProductId, skuId));
		for (const child of childRows) {
			targetSkuIds.add(child.id);
		}
	}

	const rows = await db
		.select({ retailerItemId: skuItemLinks.retailerItemId })
		.from(skuItemLinks)
		.where(inArray(skuItemLinks.canonicalSkuId, Array.from(targetSkuIds)));
	return Array.from(new Set(rows.map((row) => row.retailerItemId)));
}

async function buildSkuProductPayload(
	skuId: string,
): Promise<ProductPayload | null> {
	const db = getDb();
	const [sku] = await db
		.select({
			id: canonicalSkus.id,
			canonicalName: canonicalSkus.canonicalName,
			productType: canonicalSkus.productType,
			normalizedUnit: canonicalSkus.normalizedUnit,
			normalizedQuantity: canonicalSkus.normalizedQuantity,
			brand: canonicalSkus.brand,
		})
		.from(canonicalSkus)
		.where(eq(canonicalSkus.id, skuId))
		.limit(1);

	if (!sku) {
		return null;
	}

	const itemIds = await getItemIdsForSku(sku.id);
	const [repItem] =
		itemIds.length === 0
			? []
			: await db
					.select({
						imageUrl: retailerItems.imageUrl,
					})
					.from(retailerItems)
					.where(eq(retailerItems.id, itemIds[0]))
					.limit(1);

	return {
		id: sku.id,
		name: sku.canonicalName,
		category: sku.productType ?? "sku",
		unit: sku.normalizedUnit,
		unitQuantity:
			sku.normalizedQuantity == null ? null : String(sku.normalizedQuantity),
		brand: sku.brand,
		imageUrl: repItem?.imageUrl ?? null,
	};
}

async function resolveProduct(
	inputId: string,
): Promise<ResolvedProduct | null> {
	const db = getDb();
	const [directSku] = await db
		.select({ id: canonicalSkus.id })
		.from(canonicalSkus)
		.where(eq(canonicalSkus.id, inputId))
		.limit(1);

	if (directSku) {
		const product = await buildSkuProductPayload(directSku.id);
		if (!product) {
			return null;
		}
		return {
			product,
			retailerItemIds: await getItemIdsForSku(directSku.id),
		};
	}

	const [itemLink] = await db
		.select({ canonicalSkuId: skuItemLinks.canonicalSkuId })
		.from(skuItemLinks)
		.where(eq(skuItemLinks.retailerItemId, inputId))
		.limit(1);

	if (itemLink) {
		const product = await buildSkuProductPayload(itemLink.canonicalSkuId);
		if (!product) {
			return null;
		}
		return {
			product,
			retailerItemIds: await getItemIdsForSku(itemLink.canonicalSkuId),
		};
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

async function resolveSkuId(productId: string): Promise<string | null> {
	const db = getDb();
	const [directSku] = await db
		.select({ id: canonicalSkus.id })
		.from(canonicalSkus)
		.where(eq(canonicalSkus.id, productId))
		.limit(1);
	if (directSku) {
		return directSku.id;
	}

	const [link] = await db
		.select({ canonicalSkuId: skuItemLinks.canonicalSkuId })
		.from(skuItemLinks)
		.where(eq(skuItemLinks.retailerItemId, productId))
		.limit(1);

	return link?.canonicalSkuId ?? null;
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

export const getSimilarVariants = procedure
	.input(z.object({ productId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const clickhouse = getClickHouse();
		const resolvedSkuId = await resolveSkuId(input.productId);
		if (!resolvedSkuId) {
			return [];
		}

		const [currentSku] = await db
			.select({
				id: canonicalSkus.id,
				baseProductId: canonicalSkus.baseProductId,
			})
			.from(canonicalSkus)
			.where(eq(canonicalSkus.id, resolvedSkuId))
			.limit(1);

		if (!currentSku) {
			return [];
		}

		const baseId = currentSku.baseProductId ?? currentSku.id;
		const siblingSkus = await db
			.select({
				id: canonicalSkus.id,
				canonicalName: canonicalSkus.canonicalName,
			})
			.from(canonicalSkus)
			.where(eq(canonicalSkus.baseProductId, baseId));

		const siblingIds = siblingSkus
			.map((sku) => sku.id)
			.filter((id) => id !== currentSku.id);
		if (siblingIds.length === 0) {
			return [];
		}

		const links = await db
			.select({
				skuId: skuItemLinks.canonicalSkuId,
				retailerItemId: skuItemLinks.retailerItemId,
			})
			.from(skuItemLinks)
			.where(inArray(skuItemLinks.canonicalSkuId, siblingIds));
		if (links.length === 0) {
			return [];
		}

		const itemIds = links.map((link) => link.retailerItemId);
		const itemToSku = new Map(
			links.map((link) => [link.retailerItemId, link.skuId] as const),
		);
		const priceRows = await clickhouse.query<ClickHouseBestPriceRow>(
			`SELECT
				retailer_item_id,
				min(if(discount_price_cents > 0, discount_price_cents, price_cents)) AS best_price,
				argMin(chain_slug, if(discount_price_cents > 0, discount_price_cents, price_cents)) AS chain_slug
			FROM prices_current FINAL
			WHERE retailer_item_id IN ({itemIds:Array(String)})
			GROUP BY retailer_item_id`,
			{ itemIds },
		);

		const skuBestPrice = new Map<
			string,
			{ priceCents: number; chainSlug: string }
		>();
		for (const row of priceRows) {
			const price = parseNumber(row.best_price);
			if (price == null) {
				continue;
			}
			const skuId = itemToSku.get(row.retailer_item_id);
			if (!skuId) {
				continue;
			}
			const existing = skuBestPrice.get(skuId);
			if (!existing || price < existing.priceCents) {
				skuBestPrice.set(skuId, {
					priceCents: price,
					chainSlug: row.chain_slug,
				});
			}
		}

		const representativeItemBySku = new Map<string, string>();
		for (const link of links) {
			if (!representativeItemBySku.has(link.skuId)) {
				representativeItemBySku.set(link.skuId, link.retailerItemId);
			}
		}

		const representativeItemIds = Array.from(representativeItemBySku.values());
		const repFeatures =
			representativeItemIds.length === 0
				? []
				: await db
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
						.where(
							inArray(
								retailerItemFeatures.retailerItemId,
								representativeItemIds,
							),
						);
		const featureByItem = new Map(
			repFeatures.map((feature) => [feature.retailerItemId, feature] as const),
		);

		const repItems =
			representativeItemIds.length === 0
				? []
				: await db
						.select({ id: retailerItems.id, imageUrl: retailerItems.imageUrl })
						.from(retailerItems)
						.where(inArray(retailerItems.id, representativeItemIds));
		const imageByItem = new Map(
			repItems.map((item) => [item.id, item.imageUrl] as const),
		);

		return siblingSkus
			.filter((sku) => skuBestPrice.has(sku.id))
			.map((sku) => {
				// biome-ignore lint/style/noNonNullAssertion: filtered by .has above
				const best = skuBestPrice.get(sku.id)!;
				const repItemId = representativeItemBySku.get(sku.id);
				const feat = repItemId ? featureByItem.get(repItemId) : undefined;
				const totalAmount = feat?.totalAmount ?? null;
				const unitLabel = feat?.extractedUnit ?? null;
				const unitPriceCents =
					totalAmount != null && totalAmount > 0
						? Math.round(best.priceCents / totalAmount)
						: null;
				return {
					id: sku.id,
					name: sku.canonicalName,
					packDescription: feat ? buildPackDescription(feat) : "",
					bestPriceCents: best.priceCents,
					unitPriceCents,
					unitLabel,
					totalAmount,
					bestChainSlug: best.chainSlug,
					imageUrl: repItemId ? (imageByItem.get(repItemId) ?? null) : null,
				};
			})
			.sort((a, b) => {
				if (a.unitPriceCents != null && b.unitPriceCents != null) {
					return a.unitPriceCents - b.unitPriceCents;
				}
				if (a.unitPriceCents != null) {
					return -1;
				}
				if (b.unitPriceCents != null) {
					return 1;
				}
				return a.bestPriceCents - b.bestPriceCents;
			});
	});
