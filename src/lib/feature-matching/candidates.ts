import { and, between, eq, ne, or, sql } from "drizzle-orm";
import { retailerItemFeatures, retailerItems, skuItemLinks } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { scoreCandidate } from "./scoring";
import type {
	FeatureMatchCandidate,
	FeatureMatchItem,
	GenerateCandidatesOptions,
} from "./types";

type QueryRow = {
	retailerItemId: string;
	name: string;
	chainSlug: string | null;
	brand: string | null;
	normalizedName: string;
	normalizedCategory: string | null;
	productType: string | null;
	extractedBrand: string | null;
	extractedUnit: string | null;
	totalAmount: number | null;
	packAmount: number;
	containerType: string | null;
};

function toFeatureMatchItem(row: QueryRow): FeatureMatchItem {
	return {
		retailerItemId: row.retailerItemId,
		name: row.name,
		chainSlug: row.chainSlug,
		brand: row.brand,
		normalizedName: row.normalizedName,
		normalizedCategory: row.normalizedCategory,
		productType: row.productType,
		extractedBrand: row.extractedBrand,
		extractedUnit: row.extractedUnit,
		totalAmount: row.totalAmount,
		packAmount: row.packAmount,
		containerType: row.containerType,
	};
}

async function loadSourceItem(itemId: string): Promise<FeatureMatchItem | null> {
	const db = getDb();
	const [row] = await db
		.select({
			retailerItemId: retailerItems.id,
			name: retailerItems.name,
			chainSlug: retailerItems.chainSlug,
			brand: retailerItems.brand,
			normalizedName: retailerItemFeatures.normalizedName,
			normalizedCategory: retailerItemFeatures.normalizedCategory,
			productType: retailerItemFeatures.productType,
			extractedBrand: retailerItemFeatures.extractedBrand,
			extractedUnit: retailerItemFeatures.extractedUnit,
			totalAmount: retailerItemFeatures.totalAmount,
			packAmount: retailerItemFeatures.packAmount,
			containerType: retailerItemFeatures.containerType,
		})
		.from(retailerItems)
		.innerJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.where(eq(retailerItems.id, itemId))
		.limit(1);

	return row ? toFeatureMatchItem(row) : null;
}

function quantityRange(quantity: number | null): [number, number] | null {
	if (quantity == null || quantity <= 0) {
		return null;
	}
	const delta = quantity * 0.1;
	return [quantity - delta, quantity + delta];
}

export async function generateCandidates(
	options: GenerateCandidatesOptions,
): Promise<FeatureMatchCandidate[]> {
	const db = getDb();
	const source = await loadSourceItem(options.sourceItemId);
	if (!source) {
		return [];
	}

	const qtyRange = quantityRange(source.totalAmount);
	const blockingConditions = [];

	if (source.extractedBrand && source.normalizedCategory) {
		blockingConditions.push(
			and(
				eq(retailerItemFeatures.extractedBrand, source.extractedBrand),
				eq(retailerItemFeatures.normalizedCategory, source.normalizedCategory),
			),
		);
	}

	if (source.extractedBrand && source.extractedUnit && qtyRange) {
		blockingConditions.push(
			and(
				eq(retailerItemFeatures.extractedBrand, source.extractedBrand),
				eq(retailerItemFeatures.extractedUnit, source.extractedUnit),
				between(retailerItemFeatures.totalAmount, qtyRange[0], qtyRange[1]),
			),
		);
	}

	if (source.productType && source.containerType) {
		blockingConditions.push(
			and(
				eq(retailerItemFeatures.productType, source.productType),
				eq(retailerItemFeatures.packAmount, source.packAmount),
				eq(retailerItemFeatures.containerType, source.containerType),
			),
		);
	}

	if (blockingConditions.length === 0) {
		return [];
	}

	const rows = await db
		.select({
			retailerItemId: retailerItems.id,
			name: retailerItems.name,
			chainSlug: retailerItems.chainSlug,
			brand: retailerItems.brand,
			normalizedName: retailerItemFeatures.normalizedName,
			normalizedCategory: retailerItemFeatures.normalizedCategory,
			productType: retailerItemFeatures.productType,
			extractedBrand: retailerItemFeatures.extractedBrand,
			extractedUnit: retailerItemFeatures.extractedUnit,
			totalAmount: retailerItemFeatures.totalAmount,
			packAmount: retailerItemFeatures.packAmount,
			containerType: retailerItemFeatures.containerType,
		})
		.from(retailerItems)
		.innerJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.leftJoin(
			skuItemLinks,
			eq(skuItemLinks.retailerItemId, retailerItems.id),
		)
		.where(
			and(
				ne(retailerItems.id, source.retailerItemId),
				or(...blockingConditions),
				...(options.excludeLinked ?? true
					? [sql`${skuItemLinks.retailerItemId} IS NULL`]
					: []),
			),
		)
		.limit(1000);

	const minScore = options.minScore ?? 0;
	const limit = options.limit ?? 30;
		return rows
			.map((row) => {
			const item = toFeatureMatchItem(row);
			const breakdown = scoreCandidate(source, item);
			return {
				item,
				score: breakdown.total,
				breakdown,
			};
			})
			.filter((candidate) => candidate.score >= minScore)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
}
