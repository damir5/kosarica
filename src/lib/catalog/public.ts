import { and, asc, count, desc, eq, inArray, like, ne, or, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import {
	chains,
	familyRelations,
	offerVariantLinks,
	productFamilies,
	productVariants,
	retailerItemFeatures,
	retailerItems,
	smartCollectionMembers,
	smartCollections,
} from "@/db/schema";
import { getClickHouse, parseNumber } from "@/lib/clickhouse";
import { normalizeProductName } from "@/lib/matching/normalize";
import { chunk } from "@/lib/collections/chunk";

export type CatalogSort = "relevance" | "price_asc" | "price_desc" | "name_asc" | "name_desc";

type PriceRow = {
	retailer_item_id: string;
	chain_slug: string;
	store_id: string;
	current_price: number | string | null;
	discount_price: number | string | null;
	last_seen_at: string;
};

type FamilySummary = {
	id: string;
	slug: string;
	displayName: string;
	taxonomy: string | null;
	imageUrl: string | null;
	brandGroup: string | null;
	qualityLabel: string | null;
	variantCount: number;
	bestPriceCents: number | null;
	discountPriceCents: number | null;
	chainCount: number;
};

type VariantSummary = {
	id: string;
	displayName: string;
	packLabel: string | null;
	normalizedUnit: string | null;
	normalizedQuantity: number | null;
	packCount: number;
	containerType: string | null;
	imageUrl: string | null;
	bestPriceCents: number | null;
	discountPriceCents: number | null;
};

type FamilyOffer = {
	retailerItemId: string;
	variantId: string;
	variantDisplayName: string;
	chainSlug: string;
	chainName: string;
	storeId: string;
	currentPrice: number | null;
	discountPrice: number | null;
	effectivePrice: number | null;
	lastSeenAt: string;
	itemName: string;
	unitPriceCents: number | null;
	unitLabel: string | null;
};

function toEffectivePrice(row: {
	current_price: number | string | null;
	discount_price: number | string | null;
}): { currentPrice: number | null; discountPrice: number | null; effectivePrice: number | null } {
	const currentPrice = parseNumber(row.current_price);
	const discountPrice = parseNumber(row.discount_price);
	return {
		currentPrice,
		discountPrice,
		effectivePrice: discountPrice ?? currentPrice,
	};
}

async function loadPriceRows(itemIds: string[]): Promise<PriceRow[]> {
	if (itemIds.length === 0) {
		return [];
	}
	const clickhouse = getClickHouse();
	const rows: PriceRow[] = [];
	for (const batch of chunk(itemIds, 1000)) {
		rows.push(
			...(await clickhouse.query<PriceRow>(
				`SELECT
					retailer_item_id,
					chain_slug,
					store_id,
					price_cents AS current_price,
					discount_price_cents AS discount_price,
					target_date AS last_seen_at
				FROM prices_current FINAL
				WHERE retailer_item_id IN ({itemIds:Array(String)})`,
				{ itemIds: batch },
			)),
		);
	}
	return rows;
}

async function loadFamilyVariantCounts(
	familyIds: string[],
): Promise<Map<string, number>> {
	if (familyIds.length === 0) {
		return new Map();
	}
	const db = getDatabase();
	const rows = await db
		.select({
			familyId: productVariants.familyId,
			count: count(),
		})
		.from(productVariants)
		.where(inArray(productVariants.familyId, familyIds))
		.groupBy(productVariants.familyId);
	return new Map(rows.map((row) => [row.familyId, row.count]));
}

async function loadBestPricesForFamilies(
	familyIds: string[],
): Promise<Map<string, { bestPriceCents: number | null; discountPriceCents: number | null; chainCount: number }>> {
	if (familyIds.length === 0) {
		return new Map();
	}

	const db = getDatabase();
	const links = await db
		.select({
			familyId: productVariants.familyId,
			retailerItemId: offerVariantLinks.retailerItemId,
			chainSlug: retailerItems.chainSlug,
		})
		.from(offerVariantLinks)
		.innerJoin(productVariants, eq(productVariants.id, offerVariantLinks.variantId))
		.innerJoin(retailerItems, eq(retailerItems.id, offerVariantLinks.retailerItemId))
		.where(inArray(productVariants.familyId, familyIds));

	const rows = await loadPriceRows(links.map((link) => link.retailerItemId));
	const priceByItem = new Map(rows.map((row) => [row.retailer_item_id, row] as const));
	const summary = new Map<
		string,
		{ bestPriceCents: number | null; discountPriceCents: number | null; chainSlugs: Set<string> }
	>();

	for (const link of links) {
		const priceRow = priceByItem.get(link.retailerItemId);
		if (!priceRow) {
			continue;
		}
		const price = toEffectivePrice(priceRow);
		if (price.effectivePrice == null) {
			continue;
		}
		const existing =
			summary.get(link.familyId) ?? {
				bestPriceCents: null,
				discountPriceCents: null,
				chainSlugs: new Set<string>(),
			};
		if (
			existing.bestPriceCents == null ||
			price.effectivePrice < existing.bestPriceCents
		) {
			existing.bestPriceCents = price.effectivePrice;
			existing.discountPriceCents = price.discountPrice;
		}
		if (link.chainSlug) {
			existing.chainSlugs.add(link.chainSlug);
		}
		summary.set(link.familyId, existing);
	}

	return new Map(
		Array.from(summary.entries()).map(([familyId, value]) => [
			familyId,
			{
				bestPriceCents: value.bestPriceCents,
				discountPriceCents: value.discountPriceCents,
				chainCount: value.chainSlugs.size,
			},
		]),
	);
}

function sortFamilies(
	families: FamilySummary[],
	sort: CatalogSort,
): FamilySummary[] {
	if (sort === "price_asc") {
		return families.sort((a, b) => {
			if (a.bestPriceCents == null) return 1;
			if (b.bestPriceCents == null) return -1;
			return a.bestPriceCents - b.bestPriceCents;
		});
	}
	if (sort === "price_desc") {
		return families.sort((a, b) => {
			if (a.bestPriceCents == null) return 1;
			if (b.bestPriceCents == null) return -1;
			return b.bestPriceCents - a.bestPriceCents;
		});
	}
	if (sort === "name_desc") {
		return families.sort((a, b) => b.displayName.localeCompare(a.displayName));
	}
	return families.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function listCatalogFamilies(input: {
	page: number;
	pageSize: number;
	search?: string;
	category?: string;
	chainSlugs?: string[];
	collectionSlug?: string;
	dealsOnly?: boolean;
	sort?: CatalogSort;
}): Promise<{
	families: FamilySummary[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}> {
	const db = getDatabase();
	const conditions = [eq(productFamilies.status, "active")];

	if (input.category) {
		conditions.push(eq(productFamilies.taxonomy, input.category));
	}
	if (input.search) {
		const pattern = `%${normalizeProductName(input.search)}%`;
		conditions.push(
			or(
				like(productFamilies.titleNormalized, pattern),
				like(sql`COALESCE(${productFamilies.brandGroup}, '')`, `%${input.search}%`),
			)!,
		);
	}

	let familyIdsFromCollection: string[] | null = null;
	if (input.collectionSlug) {
		const collectionRows = await db
			.select({ familyId: smartCollectionMembers.familyId })
			.from(smartCollectionMembers)
			.innerJoin(
				smartCollections,
				eq(smartCollections.id, smartCollectionMembers.collectionId),
			)
			.where(eq(smartCollections.slug, input.collectionSlug));
		familyIdsFromCollection = collectionRows.map((row) => row.familyId);
		if (familyIdsFromCollection.length === 0) {
			return {
				families: [],
				total: 0,
				page: input.page,
				pageSize: input.pageSize,
				totalPages: 0,
			};
		}
		conditions.push(inArray(productFamilies.id, familyIdsFromCollection));
	}

	if (input.chainSlugs && input.chainSlugs.length > 0) {
		const chainFamilyRows = await db
			.selectDistinct({ familyId: productVariants.familyId })
			.from(offerVariantLinks)
			.innerJoin(productVariants, eq(productVariants.id, offerVariantLinks.variantId))
			.innerJoin(retailerItems, eq(retailerItems.id, offerVariantLinks.retailerItemId))
			.where(inArray(retailerItems.chainSlug, input.chainSlugs));
		if (chainFamilyRows.length === 0) {
			return {
				families: [],
				total: 0,
				page: input.page,
				pageSize: input.pageSize,
				totalPages: 0,
			};
		}
		conditions.push(inArray(productFamilies.id, chainFamilyRows.map((row) => row.familyId)));
	}

	const familyRows = await db
		.select({
			id: productFamilies.id,
			slug: productFamilies.slug,
			displayName: productFamilies.displayName,
			taxonomy: productFamilies.taxonomy,
			imageUrl: productFamilies.imageUrl,
			brandGroup: productFamilies.brandGroup,
			qualityLabel: productFamilies.qualityLabel,
		})
		.from(productFamilies)
		.where(and(...conditions))
		.orderBy(
			input.sort === "name_desc" ? desc(productFamilies.displayName) : asc(productFamilies.displayName),
		);

	const variantCounts = await loadFamilyVariantCounts(familyRows.map((row) => row.id));
	const priceSummary = await loadBestPricesForFamilies(familyRows.map((row) => row.id));

	let families = familyRows.map((row) => ({
		id: row.id,
		slug: row.slug,
		displayName: row.displayName,
		taxonomy: row.taxonomy,
		imageUrl: row.imageUrl,
		brandGroup: row.brandGroup,
		qualityLabel: row.qualityLabel,
		variantCount: variantCounts.get(row.id) ?? 0,
		bestPriceCents: priceSummary.get(row.id)?.bestPriceCents ?? null,
		discountPriceCents: priceSummary.get(row.id)?.discountPriceCents ?? null,
		chainCount: priceSummary.get(row.id)?.chainCount ?? 0,
	}));

	if (input.dealsOnly) {
		families = families.filter(
			(family) =>
				family.discountPriceCents != null &&
				family.bestPriceCents != null &&
				family.discountPriceCents !== family.bestPriceCents,
		);
	}

	const total = families.length;
	families = sortFamilies(families, input.sort ?? (input.search ? "relevance" : "name_asc"));
	const offset = Math.max(0, (input.page - 1) * input.pageSize);
	const paged = families.slice(offset, offset + input.pageSize);

	return {
		families: paged,
		total,
		page: input.page,
		pageSize: input.pageSize,
		totalPages: Math.ceil(total / input.pageSize),
	};
}

export async function listCatalogCategories(): Promise<string[]> {
	const db = getDatabase();
	const rows = await db
		.selectDistinct({ taxonomy: productFamilies.taxonomy })
		.from(productFamilies)
		.where(
			and(
				eq(productFamilies.status, "active"),
				sql`${productFamilies.taxonomy} IS NOT NULL AND ${productFamilies.taxonomy} != ''`,
			),
		);
	return rows
		.map((row) => row.taxonomy)
		.filter((value): value is string => Boolean(value))
		.sort((a, b) => a.localeCompare(b));
}

export async function getCatalogFamily(input: {
	familyIdOrSlug: string;
}): Promise<{
	id: string;
	slug: string;
	displayName: string;
	taxonomy: string | null;
	imageUrl: string | null;
	brandGroup: string | null;
	qualityLabel: string | null;
	bestPriceCents: number | null;
	discountPriceCents: number | null;
	chainCount: number;
} | null> {
	const db = getDatabase();
	const [family] = await db
		.select({
			id: productFamilies.id,
			slug: productFamilies.slug,
			displayName: productFamilies.displayName,
			taxonomy: productFamilies.taxonomy,
			imageUrl: productFamilies.imageUrl,
			brandGroup: productFamilies.brandGroup,
			qualityLabel: productFamilies.qualityLabel,
		})
		.from(productFamilies)
		.where(
			and(
				eq(productFamilies.status, "active"),
				or(
					eq(productFamilies.id, input.familyIdOrSlug),
					eq(productFamilies.slug, input.familyIdOrSlug),
				)!,
			),
		)
		.limit(1);

	if (!family) {
		return null;
	}

	const priceSummary = await loadBestPricesForFamilies([family.id]);
	return {
		...family,
		bestPriceCents: priceSummary.get(family.id)?.bestPriceCents ?? null,
		discountPriceCents: priceSummary.get(family.id)?.discountPriceCents ?? null,
		chainCount: priceSummary.get(family.id)?.chainCount ?? 0,
	};
}

export async function getCatalogFamilyGraph(input: { familyId: string }): Promise<{
	variants: VariantSummary[];
	relatedFamilies: FamilySummary[];
	collectionPreviews: Array<{
		id: string;
		slug: string;
		title: string;
		families: FamilySummary[];
	}>;
}> {
	const db = getDatabase();

	const variants = await db
		.select({
			id: productVariants.id,
			displayName: productVariants.displayName,
			packLabel: productVariants.packLabel,
			normalizedUnit: productVariants.normalizedUnit,
			normalizedQuantity: productVariants.normalizedQuantity,
			packCount: productVariants.packCount,
			containerType: productVariants.containerType,
			imageUrl: productVariants.imageUrl,
		})
		.from(productVariants)
		.where(eq(productVariants.familyId, input.familyId))
		.orderBy(
			asc(productVariants.packCount),
			asc(productVariants.normalizedQuantity),
			asc(productVariants.displayName),
		);

	const variantIds = variants.map((variant) => variant.id);
	const variantLinks =
		variantIds.length === 0
			? []
			: await db
					.select({
						variantId: offerVariantLinks.variantId,
						retailerItemId: offerVariantLinks.retailerItemId,
					})
					.from(offerVariantLinks)
					.where(inArray(offerVariantLinks.variantId, variantIds));
	const variantPriceMap = new Map<string, { bestPriceCents: number | null; discountPriceCents: number | null }>();
	const priceRows = await loadPriceRows(variantLinks.map((row) => row.retailerItemId));
	const linkPriceByItem = new Map(priceRows.map((row) => [row.retailer_item_id, row] as const));
	for (const link of variantLinks) {
		const row = linkPriceByItem.get(link.retailerItemId);
		if (!row) {
			continue;
		}
		const price = toEffectivePrice(row);
		const existing = variantPriceMap.get(link.variantId);
		if (
			price.effectivePrice != null &&
			(!existing?.bestPriceCents || price.effectivePrice < existing.bestPriceCents)
		) {
			variantPriceMap.set(link.variantId, {
				bestPriceCents: price.effectivePrice,
				discountPriceCents: price.discountPrice,
			});
		}
	}

	const relatedRows = await db
		.select({
			id: productFamilies.id,
			slug: productFamilies.slug,
			displayName: productFamilies.displayName,
			taxonomy: productFamilies.taxonomy,
			imageUrl: productFamilies.imageUrl,
			brandGroup: productFamilies.brandGroup,
			qualityLabel: productFamilies.qualityLabel,
		})
		.from(familyRelations)
		.innerJoin(productFamilies, eq(productFamilies.id, familyRelations.targetFamilyId))
		.where(eq(familyRelations.sourceFamilyId, input.familyId))
		.limit(6);
	const relatedFamilies = await enrichFamilySummaries(relatedRows);

	const collectionRows = await db
		.select({
			id: smartCollections.id,
			slug: smartCollections.slug,
			title: smartCollections.title,
		})
		.from(smartCollectionMembers)
		.innerJoin(
			smartCollections,
			eq(smartCollections.id, smartCollectionMembers.collectionId),
		)
		.where(eq(smartCollectionMembers.familyId, input.familyId))
		.orderBy(asc(smartCollections.title))
		.limit(3);

	const collectionPreviews = [];
	for (const collection of collectionRows) {
		const memberRows = await db
			.select({
				id: productFamilies.id,
				slug: productFamilies.slug,
				displayName: productFamilies.displayName,
				taxonomy: productFamilies.taxonomy,
				imageUrl: productFamilies.imageUrl,
				brandGroup: productFamilies.brandGroup,
				qualityLabel: productFamilies.qualityLabel,
			})
			.from(smartCollectionMembers)
			.innerJoin(productFamilies, eq(productFamilies.id, smartCollectionMembers.familyId))
			.where(
				and(
					eq(smartCollectionMembers.collectionId, collection.id),
					ne(productFamilies.id, input.familyId),
				),
			)
			.limit(6);
		collectionPreviews.push({
			...collection,
			families: await enrichFamilySummaries(memberRows),
		});
	}

	return {
		variants: variants.map((variant) => ({
			...variant,
			bestPriceCents: variantPriceMap.get(variant.id)?.bestPriceCents ?? null,
			discountPriceCents: variantPriceMap.get(variant.id)?.discountPriceCents ?? null,
		})),
		relatedFamilies,
		collectionPreviews,
	};
}

async function enrichFamilySummaries(
	rows: Array<{
		id: string;
		slug: string;
		displayName: string;
		taxonomy: string | null;
		imageUrl: string | null;
		brandGroup: string | null;
		qualityLabel: string | null;
	}>,
): Promise<FamilySummary[]> {
	const variantCounts = await loadFamilyVariantCounts(rows.map((row) => row.id));
	const prices = await loadBestPricesForFamilies(rows.map((row) => row.id));
	return rows.map((row) => ({
		...row,
		variantCount: variantCounts.get(row.id) ?? 0,
		bestPriceCents: prices.get(row.id)?.bestPriceCents ?? null,
		discountPriceCents: prices.get(row.id)?.discountPriceCents ?? null,
		chainCount: prices.get(row.id)?.chainCount ?? 0,
	}));
}

export async function getCatalogFamilyOffers(input: {
	familyId: string;
	variantId?: string;
}): Promise<FamilyOffer[]> {
	const db = getDatabase();
	const variantFilter = input.variantId
		? eq(productVariants.id, input.variantId)
		: eq(productVariants.familyId, input.familyId);
	const links = await db
		.select({
			retailerItemId: offerVariantLinks.retailerItemId,
			variantId: productVariants.id,
			variantDisplayName: productVariants.displayName,
			itemName: retailerItems.name,
			chainSlug: retailerItems.chainSlug,
			chainName: chains.name,
			extractedUnit: retailerItemFeatures.extractedUnit,
			totalAmount: retailerItemFeatures.totalAmount,
		})
		.from(offerVariantLinks)
		.innerJoin(productVariants, eq(productVariants.id, offerVariantLinks.variantId))
		.innerJoin(retailerItems, eq(retailerItems.id, offerVariantLinks.retailerItemId))
		.leftJoin(chains, eq(chains.slug, retailerItems.chainSlug))
		.leftJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.where(variantFilter);

	const priceRows = await loadPriceRows(links.map((link) => link.retailerItemId));
	const priceMap = new Map(priceRows.map((row) => [row.retailer_item_id, row] as const));
	return links
		.map((link) => {
			const priceRow = priceMap.get(link.retailerItemId);
			const price = priceRow ? toEffectivePrice(priceRow) : null;
			const totalAmount = link.totalAmount ?? null;
			return {
				retailerItemId: link.retailerItemId,
				variantId: link.variantId,
				variantDisplayName: link.variantDisplayName,
				chainSlug: link.chainSlug ?? "unknown",
				chainName: link.chainName ?? link.chainSlug ?? "unknown",
				storeId: priceRow?.store_id ?? "",
				currentPrice: price?.currentPrice ?? null,
				discountPrice: price?.discountPrice ?? null,
				effectivePrice: price?.effectivePrice ?? null,
				lastSeenAt: priceRow?.last_seen_at ?? "",
				itemName: link.itemName,
				unitPriceCents:
					price?.effectivePrice != null && totalAmount != null && totalAmount > 0
						? Math.round(price.effectivePrice / totalAmount)
						: null,
				unitLabel: link.extractedUnit ?? null,
			};
		})
		.filter((offer) => offer.effectivePrice != null)
		.sort((a, b) => (a.effectivePrice ?? 0) - (b.effectivePrice ?? 0));
}

export async function getCatalogCollection(input: {
	slug: string;
	page: number;
	pageSize: number;
}): Promise<{
	collection: { id: string; slug: string; title: string; collectionType: string } | null;
	families: FamilySummary[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}> {
	const db = getDatabase();
	const [collection] = await db
		.select({
			id: smartCollections.id,
			slug: smartCollections.slug,
			title: smartCollections.title,
			collectionType: smartCollections.collectionType,
		})
		.from(smartCollections)
		.where(eq(smartCollections.slug, input.slug))
		.limit(1);

	if (!collection) {
		return {
			collection: null,
			families: [],
			total: 0,
			page: input.page,
			pageSize: input.pageSize,
			totalPages: 0,
		};
	}

	const list = await listCatalogFamilies({
		page: input.page,
		pageSize: input.pageSize,
		collectionSlug: input.slug,
		sort: "name_asc",
	});

	return {
		collection,
		families: list.families,
		total: list.total,
		page: list.page,
		pageSize: list.pageSize,
		totalPages: list.totalPages,
	};
}

export async function getFeaturedCollections(limit = 6): Promise<
	Array<{ id: string; slug: string; title: string; collectionType: string }>
> {
	const db = getDatabase();
	return await db
		.select({
			id: smartCollections.id,
			slug: smartCollections.slug,
			title: smartCollections.title,
			collectionType: smartCollections.collectionType,
		})
		.from(smartCollections)
		.where(eq(smartCollections.status, "active"))
		.orderBy(asc(smartCollections.title))
		.limit(limit);
}
