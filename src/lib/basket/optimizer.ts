import { and, eq, inArray } from "drizzle-orm";
import { chains, stores } from "@/db/schema";
import { getClickHouse } from "@/lib/clickhouse";
import { getDb } from "@/utils/bindings";

export interface BasketItemInput {
	itemId: string;
	name: string;
	quantity: number;
}

export interface LocationInput {
	latitude: number;
	longitude: number;
}

export interface OptimizeRequestInput {
	chainSlug: string;
	basketItems: BasketItemInput[];
	location?: LocationInput;
	maxDistance?: number;
	maxStores?: number;
}

export interface MissingItem {
	itemId: string;
	itemName: string;
	penalty: number;
	isOptional: boolean;
}

export interface ItemPriceInfo {
	itemId: string;
	itemName: string;
	quantity: number;
	basePrice: number;
	effectivePrice: number;
	hasDiscount: boolean;
	discountPrice?: number;
	lineTotal: number;
}

export interface SingleStoreResult {
	storeId: string;
	coverageRatio: number;
	coverageBin: number;
	sortingTotal: number;
	realTotal: number;
	missingItems?: MissingItem[];
	items?: ItemPriceInfo[];
	distance: number;
}

export interface StoreAllocation {
	storeId: string;
	items: ItemPriceInfo[];
	storeTotal: number;
	distance: number;
	visitOrder: number;
}

export interface MultiStoreResult {
	stores: StoreAllocation[];
	combinedTotal: number;
	coverageRatio: number;
	unassignedItems?: MissingItem[];
	algorithmUsed: string;
}

interface PriceRow {
	store_id: string;
	retailer_item_id: string;
	price_cents: number | string | null;
	discount_price_cents?: number | string | null;
}

interface AvgPriceRow {
	retailer_item_id: string;
	avg_price: number | string | null;
}

const COVERAGE_THRESHOLDS = [1.0, 0.9, 0.8];
const MISSING_ITEM_PENALTY_MULT = 2;
const MISSING_ITEM_FALLBACK = 10000;
const DEFAULT_MAX_STORES = 5;

function parseNumber(value: number | string | null | undefined): number | null {
	if (typeof value === "number") {
		return value;
	}
	if (value === null || value === undefined) {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function calculateCoverageBin(ratio: number): number {
	if (ratio >= COVERAGE_THRESHOLDS[0]) {
		return 4;
	}
	if (ratio >= COVERAGE_THRESHOLDS[1]) {
		return 3;
	}
	if (ratio >= COVERAGE_THRESHOLDS[2]) {
		return 2;
	}
	return 1;
}

function getEffectivePrice(priceCents: number, discountPrice?: number | null) {
	if (
		discountPrice !== null &&
		discountPrice !== undefined &&
		discountPrice > 0 &&
		discountPrice < priceCents
	) {
		return {
			effectivePrice: discountPrice,
			hasDiscount: true,
			discountPrice,
		};
	}
	return { effectivePrice: priceCents, hasDiscount: false };
}

function parseCoordinate(value?: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function degreesToRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function haversineDistanceKm(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const radiusKm = 6371;
	const dLat = degreesToRadians(lat2 - lat1);
	const dLon = degreesToRadians(lon2 - lon1);
	const rLat1 = degreesToRadians(lat1);
	const rLat2 = degreesToRadians(lat2);

	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return radiusKm * c;
}

async function getLatestTargetDate(chainSlug: string): Promise<string | null> {
	const clickhouse = getClickHouse();
	const rows = await clickhouse.query<{ target_date?: string | null }>(
		"SELECT max(target_date) AS target_date FROM prices WHERE chain_slug = {chainSlug:String}",
		{ chainSlug },
	);
	const targetDate = rows[0]?.target_date;
	return targetDate ?? null;
}

function getPenaltyForItem(
	itemId: string,
	avgPriceMap: Map<string, number>,
): number {
	const avgPrice = avgPriceMap.get(itemId);
	if (!avgPrice || avgPrice <= 0) {
		return MISSING_ITEM_FALLBACK;
	}
	return Math.round(avgPrice * MISSING_ITEM_PENALTY_MULT);
}

function buildItemPriceInfo(
	item: BasketItemInput,
	priceCents: number,
	discountPrice?: number | null,
): ItemPriceInfo {
	const {
		effectivePrice,
		hasDiscount,
		discountPrice: resolvedDiscount,
	} = getEffectivePrice(priceCents, discountPrice);
	const lineTotal = effectivePrice * item.quantity;

	return {
		itemId: item.itemId,
		itemName: item.name,
		quantity: item.quantity,
		basePrice: priceCents,
		effectivePrice,
		hasDiscount,
		discountPrice: resolvedDiscount,
		lineTotal,
	};
}

function sortSingleStoreResults(results: SingleStoreResult[]): void {
	results.sort((a, b) => {
		if (a.coverageBin !== b.coverageBin) {
			return b.coverageBin - a.coverageBin;
		}
		if (a.sortingTotal !== b.sortingTotal) {
			return a.sortingTotal - b.sortingTotal;
		}
		if (a.distance !== b.distance) {
			if (a.distance > 0 && b.distance > 0) {
				return a.distance - b.distance;
			}
			return a.distance > 0 ? -1 : 1;
		}
		return a.storeId.localeCompare(b.storeId);
	});
}

async function loadStoreDistances(
	storeIds: string[],
	chainSlug: string,
	location?: LocationInput,
): Promise<Map<string, number>> {
	const distances = new Map<string, number>();
	if (!location || storeIds.length === 0) {
		return distances;
	}

	const db = getDb();
	const rows = await db
		.select({
			id: stores.id,
			latitude: stores.latitude,
			longitude: stores.longitude,
		})
		.from(stores)
		.where(and(inArray(stores.id, storeIds), eq(stores.chainSlug, chainSlug)));

	for (const row of rows) {
		const lat = parseCoordinate(row.latitude);
		const lon = parseCoordinate(row.longitude);
		if (lat === null || lon === null) {
			continue;
		}
		const distance = haversineDistanceKm(
			location.latitude,
			location.longitude,
			lat,
			lon,
		);
		distances.set(row.id, distance);
	}

	return distances;
}

async function loadChainSlugs(): Promise<string[]> {
	const db = getDb();
	const rows = await db.select({ slug: chains.slug }).from(chains);
	return rows.map((row) => row.slug);
}

async function loadPriceData(
	chainSlug: string,
	targetDate: string,
	itemIds: string[],
): Promise<{
	storePriceMap: Map<string, Map<string, PriceRow>>;
	avgPriceMap: Map<string, number>;
}> {
	const clickhouse = getClickHouse();
	const storePriceMap = new Map<string, Map<string, PriceRow>>();
	const avgPriceMap = new Map<string, number>();

	if (itemIds.length === 0) {
		return { storePriceMap, avgPriceMap };
	}

	const priceRows = await clickhouse.query<PriceRow>(
		`SELECT
			store_id,
			retailer_item_id,
			argMax(price_cents, imported_at) AS price_cents,
			argMax(discount_price_cents, imported_at) AS discount_price_cents
		FROM prices
		WHERE chain_slug = {chainSlug:String}
			AND target_date = {targetDate:Date}
			AND retailer_item_id IN ({itemIds:Array(String)})
		GROUP BY store_id, retailer_item_id`,
		{ chainSlug, targetDate, itemIds },
	);

	for (const row of priceRows) {
		const storeId = row.store_id;
		if (!storePriceMap.has(storeId)) {
			storePriceMap.set(storeId, new Map());
		}
		storePriceMap.get(storeId)?.set(row.retailer_item_id, row);
	}

	const avgRows = await clickhouse.query<AvgPriceRow>(
		`SELECT
			retailer_item_id,
			avg(
				if(
					discount_price_cents > 0 AND discount_price_cents < price_cents,
					discount_price_cents,
					price_cents
				)
			) AS avg_price
		FROM prices
		WHERE chain_slug = {chainSlug:String}
			AND target_date = {targetDate:Date}
			AND retailer_item_id IN ({itemIds:Array(String)})
		GROUP BY retailer_item_id`,
		{ chainSlug, targetDate, itemIds },
	);

	for (const row of avgRows) {
		const avg = parseNumber(row.avg_price);
		if (avg !== null && avg > 0) {
			avgPriceMap.set(row.retailer_item_id, avg);
		}
	}

	return { storePriceMap, avgPriceMap };
}

function filterStoresByDistance(
	storeIds: string[],
	distances: Map<string, number>,
	maxDistance?: number,
): string[] {
	if (distances.size === 0) {
		return storeIds;
	}
	const maxDist = maxDistance && maxDistance > 0 ? maxDistance : null;

	return storeIds.filter((storeId) => {
		const distance = distances.get(storeId);
		if (distance === undefined) {
			return false;
		}
		if (maxDist !== null && distance > maxDist) {
			return false;
		}
		return true;
	});
}

export async function optimizeSingleStore(
	input: OptimizeRequestInput,
): Promise<{ results: SingleStoreResult[]; total: number }> {
	const itemIds = Array.from(
		new Set(input.basketItems.map((item) => item.itemId)),
	);
	const targetDate = await getLatestTargetDate(input.chainSlug);
	if (!targetDate) {
		return { results: [], total: 0 };
	}

	const { storePriceMap, avgPriceMap } = await loadPriceData(
		input.chainSlug,
		targetDate,
		itemIds,
	);

	const storeIds = Array.from(storePriceMap.keys());
	if (storeIds.length === 0) {
		return { results: [], total: 0 };
	}

	const distances = await loadStoreDistances(
		storeIds,
		input.chainSlug,
		input.location,
	);
	const candidateStoreIds = filterStoresByDistance(
		storeIds,
		distances,
		input.maxDistance,
	);

	const results: SingleStoreResult[] = [];
	for (const storeId of candidateStoreIds) {
		const storePrices = storePriceMap.get(storeId) ?? new Map();
		let foundCount = 0;
		let sortingTotal = 0;
		let realTotal = 0;
		const items: ItemPriceInfo[] = [];
		const missingItems: MissingItem[] = [];

		for (const item of input.basketItems) {
			const priceRow = storePrices.get(item.itemId);
			if (!priceRow) {
				const penalty = getPenaltyForItem(item.itemId, avgPriceMap);
				missingItems.push({
					itemId: item.itemId,
					itemName: item.name,
					penalty,
					isOptional: false,
				});
				sortingTotal += penalty * item.quantity;
				continue;
			}

			const priceCents = parseNumber(priceRow.price_cents);
			if (priceCents === null) {
				const penalty = getPenaltyForItem(item.itemId, avgPriceMap);
				missingItems.push({
					itemId: item.itemId,
					itemName: item.name,
					penalty,
					isOptional: false,
				});
				sortingTotal += penalty * item.quantity;
				continue;
			}
			const discountPrice =
				priceRow.discount_price_cents === null ||
				priceRow.discount_price_cents === undefined
					? null
					: parseNumber(priceRow.discount_price_cents);

			const itemInfo = buildItemPriceInfo(item, priceCents, discountPrice);
			items.push(itemInfo);
			foundCount += 1;
			sortingTotal += itemInfo.lineTotal;
			realTotal += itemInfo.lineTotal;
		}

		const coverageRatio =
			input.basketItems.length > 0 ? foundCount / input.basketItems.length : 0;

		results.push({
			storeId,
			coverageRatio,
			coverageBin: calculateCoverageBin(coverageRatio),
			sortingTotal,
			realTotal,
			missingItems,
			items,
			distance: distances.get(storeId) ?? 0,
		});
	}

	sortSingleStoreResults(results);

	const limit = input.maxStores && input.maxStores > 0 ? input.maxStores : 50;
	const limitedResults = results.slice(0, limit);

	return { results: limitedResults, total: limitedResults.length };
}

export async function optimizeMultiStore(
	input: OptimizeRequestInput,
): Promise<MultiStoreResult> {
	const itemIds = Array.from(
		new Set(input.basketItems.map((item) => item.itemId)),
	);
	const targetDate = await getLatestTargetDate(input.chainSlug);
	if (!targetDate) {
		return {
			stores: [],
			combinedTotal: 0,
			coverageRatio: 0,
			unassignedItems: input.basketItems.map((item) => ({
				itemId: item.itemId,
				itemName: item.name,
				penalty: MISSING_ITEM_FALLBACK,
				isOptional: false,
			})),
			algorithmUsed: "greedy",
		};
	}

	const { storePriceMap, avgPriceMap } = await loadPriceData(
		input.chainSlug,
		targetDate,
		itemIds,
	);

	const storeIds = Array.from(storePriceMap.keys());
	if (storeIds.length === 0) {
		return {
			stores: [],
			combinedTotal: 0,
			coverageRatio: 0,
			unassignedItems: input.basketItems.map((item) => ({
				itemId: item.itemId,
				itemName: item.name,
				penalty: MISSING_ITEM_FALLBACK,
				isOptional: false,
			})),
			algorithmUsed: "greedy",
		};
	}

	const distances = await loadStoreDistances(
		storeIds,
		input.chainSlug,
		input.location,
	);
	const candidateStoreIds = filterStoresByDistance(
		storeIds,
		distances,
		input.maxDistance,
	);

	const maxStores =
		input.maxStores && input.maxStores > 0
			? Math.min(input.maxStores, 10)
			: DEFAULT_MAX_STORES;

	const remainingItems = new Set(itemIds);
	const basketItemMap = new Map(
		input.basketItems.map((item) => [item.itemId, item]),
	);

	const selectedStores: {
		storeId: string;
		items: ItemPriceInfo[];
		storeTotal: number;
	}[] = [];

	const usedStores = new Set<string>();

	while (remainingItems.size > 0 && selectedStores.length < maxStores) {
		let bestStoreId: string | null = null;
		let bestCoverage = 0;
		let bestCost = Number.POSITIVE_INFINITY;
		let bestItems: ItemPriceInfo[] = [];
		let bestStoreTotal = 0;

		for (const storeId of candidateStoreIds) {
			if (usedStores.has(storeId)) {
				continue;
			}
			const storePrices = storePriceMap.get(storeId);
			if (!storePrices) {
				continue;
			}

			const itemsForStore: ItemPriceInfo[] = [];
			let storeTotal = 0;
			let coverage = 0;

			for (const itemId of remainingItems) {
				const item = basketItemMap.get(itemId);
				if (!item) {
					continue;
				}
				const priceRow = storePrices.get(itemId);
				if (!priceRow) {
					continue;
				}
				const priceCents = parseNumber(priceRow.price_cents);
				if (priceCents === null) {
					continue;
				}
				const discountPrice =
					priceRow.discount_price_cents === null ||
					priceRow.discount_price_cents === undefined
						? null
						: parseNumber(priceRow.discount_price_cents);
				const itemInfo = buildItemPriceInfo(item, priceCents, discountPrice);
				itemsForStore.push(itemInfo);
				storeTotal += itemInfo.lineTotal;
				coverage += 1;
			}

			if (coverage === 0) {
				continue;
			}

			if (
				coverage > bestCoverage ||
				(coverage === bestCoverage && storeTotal < bestCost) ||
				(coverage === bestCoverage &&
					storeTotal === bestCost &&
					bestStoreId !== null &&
					storeId < bestStoreId)
			) {
				bestStoreId = storeId;
				bestCoverage = coverage;
				bestCost = storeTotal;
				bestItems = itemsForStore;
				bestStoreTotal = storeTotal;
			}
		}

		if (!bestStoreId) {
			break;
		}

		usedStores.add(bestStoreId);
		selectedStores.push({
			storeId: bestStoreId,
			items: bestItems,
			storeTotal: bestStoreTotal,
		});

		for (const itemInfo of bestItems) {
			remainingItems.delete(itemInfo.itemId);
		}
	}

	const storeAllocations: StoreAllocation[] = selectedStores.map(
		(store, index) => ({
			storeId: store.storeId,
			items: store.items,
			storeTotal: store.storeTotal,
			distance: distances.get(store.storeId) ?? 0,
			visitOrder: index + 1,
		}),
	);

	const combinedTotal = storeAllocations.reduce(
		(total, store) => total + store.storeTotal,
		0,
	);

	const unassignedItems: MissingItem[] = [];
	for (const itemId of remainingItems) {
		const item = basketItemMap.get(itemId);
		if (!item) {
			continue;
		}
		const penalty = getPenaltyForItem(itemId, avgPriceMap);
		unassignedItems.push({
			itemId,
			itemName: item.name,
			penalty,
			isOptional: false,
		});
	}

	const coverageRatio =
		input.basketItems.length > 0
			? (input.basketItems.length - remainingItems.size) /
				input.basketItems.length
			: 0;

	return {
		stores: storeAllocations,
		combinedTotal,
		coverageRatio,
		unassignedItems,
		algorithmUsed: "greedy",
	};
}

export async function getCacheHealth(): Promise<{
	status: "ok" | "degraded";
	chains: {
		chainSlug: string;
		loadedAt: number;
		isStale: boolean;
		estimatedMB: number;
	}[];
}> {
	const clickhouse = getClickHouse();
	const chainSlugs = await loadChainSlugs();
	const rows = await clickhouse.query<{
		chain_slug: string;
		target_date: string | null;
	}>(
		"SELECT chain_slug, max(target_date) AS target_date FROM prices GROUP BY chain_slug",
	);

	const latestMap = new Map<string, string | null>();
	for (const row of rows) {
		latestMap.set(row.chain_slug, row.target_date);
	}

	const chainsWithData =
		chainSlugs.length > 0 ? chainSlugs : Array.from(latestMap.keys());

	const chainsStatus = chainsWithData.map((chainSlug) => {
		const targetDate = latestMap.get(chainSlug) ?? null;
		const loadedAt = targetDate
			? Math.floor(new Date(`${targetDate}T00:00:00Z`).getTime() / 1000)
			: 0;
		return {
			chainSlug,
			loadedAt,
			isStale: !targetDate,
			estimatedMB: 0,
		};
	});

	const status = chainsStatus.some((chain) => !chain.isStale)
		? "ok"
		: "degraded";

	return { status, chains: chainsStatus };
}
