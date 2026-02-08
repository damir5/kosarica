import { eq, sql } from "drizzle-orm";
import { retailerItemFeatures, skuItemLinks } from "@/db/schema";
import { getLatestEffectivePricesByItemId } from "@/lib/clickhouse/latest-prices";
import { median } from "@/lib/math/median";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import type { CatalogConflict } from "./types";

const log = createLogger("matching");

type DuplicateLinkRow = {
	retailer_item_id: string;
	link_count: number | string;
	sku_ids: string[];
};

type SkuFeatureRow = {
	sku_id: string;
	retailer_item_id: string;
	normalized_category: string | null;
	extracted_brand: string | null;
	variant: string | null;
};

const CONFLICTING_VARIANT_TERM_PAIRS: Array<[string, string]> = [
	["zero", "original"],
	["zero", "regular"],
	["diet", "classic"],
	["diet", "regular"],
	["light", "regular"],
	["bez secera", "original"],
];

function getRows<T>(result: unknown): T[] {
	if (Array.isArray(result)) {
		return result as T[];
	}
	return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function addGroupConflict(
	conflicts: CatalogConflict[],
	skuId: string,
	type: CatalogConflict["type"],
	message: string,
	details: Record<string, unknown>,
	severity: CatalogConflict["severity"] = "warning",
) {
	conflicts.push({
		type,
		skuId,
		severity,
		message,
		details,
	});
}

export async function detectCatalogConflicts(): Promise<CatalogConflict[]> {
	const db = getDb();
	const conflicts: CatalogConflict[] = [];

	const duplicateLinkResult = await db.execute(sql`
		SELECT
			retailer_item_id,
			COUNT(*)::int AS link_count,
			array_agg(canonical_sku_id) AS sku_ids
		FROM sku_item_links
		GROUP BY retailer_item_id
		HAVING COUNT(*) > 1
	`);
	const duplicateRows = getRows<DuplicateLinkRow>(duplicateLinkResult);

	for (const row of duplicateRows) {
		conflicts.push({
			type: "duplicate_item_link",
			skuId: row.sku_ids[0] ?? "unknown",
			retailerItemId: row.retailer_item_id,
			severity: "error",
			message: "Retailer item is linked to multiple canonical SKUs",
			details: {
				skuIds: row.sku_ids,
				linkCount: Number(row.link_count),
			},
		});
	}

	const featureRows = await db
		.select({
			sku_id: skuItemLinks.canonicalSkuId,
			retailer_item_id: skuItemLinks.retailerItemId,
			normalized_category: retailerItemFeatures.normalizedCategory,
			extracted_brand: retailerItemFeatures.extractedBrand,
			variant: retailerItemFeatures.variant,
		})
		.from(skuItemLinks)
		.leftJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, skuItemLinks.retailerItemId),
		);

	const bySku = new Map<string, SkuFeatureRow[]>();
	for (const row of featureRows) {
		if (!bySku.has(row.sku_id)) {
			bySku.set(row.sku_id, []);
		}
		bySku.get(row.sku_id)?.push(row);
	}

	const allItemIds = featureRows.map((row) => row.retailer_item_id);
	const priceByItem = await getLatestEffectivePricesByItemId(allItemIds);

	for (const [skuId, rows] of bySku.entries()) {
		const categories = new Set(
			rows
				.map((row) => row.normalized_category?.trim().toLowerCase())
				.filter((value): value is string => Boolean(value)),
		);
		if (categories.size > 1) {
			addGroupConflict(
				conflicts,
				skuId,
				"category_mismatch",
				"Multiple categories detected inside one canonical SKU",
				{ categories: Array.from(categories) },
			);
		}

		const brands = new Set(
			rows
				.map((row) => row.extracted_brand?.trim().toLowerCase())
				.filter((value): value is string => Boolean(value)),
		);
		if (brands.size > 1) {
			addGroupConflict(conflicts, skuId, "brand_conflict", "Multiple brands detected inside one canonical SKU", {
				brands: Array.from(brands),
			});
		}

		const variants = new Set(
			rows
				.map((row) => row.variant?.trim().toLowerCase())
				.filter((value): value is string => Boolean(value)),
		);
		for (const [left, right] of CONFLICTING_VARIANT_TERM_PAIRS) {
			const hasLeft = Array.from(variants).some((variant) =>
				variant.includes(left),
			);
			const hasRight = Array.from(variants).some((variant) =>
				variant.includes(right),
			);
			if (hasLeft && hasRight) {
				addGroupConflict(
					conflicts,
					skuId,
					"variant_conflict",
					`Variant conflict terms detected in same SKU: "${left}" vs "${right}"`,
					{
						conflictingPair: [left, right],
						variants: Array.from(variants),
					},
				);
				break;
			}
		}

		const prices = rows
			.map((row) => priceByItem.get(row.retailer_item_id) ?? null)
			.filter((price): price is number => price != null);
		const med = median(prices);
		if (med != null && med > 0) {
			for (const row of rows) {
				const price = priceByItem.get(row.retailer_item_id);
				if (price == null) {
					continue;
				}
				const variance = Math.abs(price - med) / med;
				if (variance > 0.5) {
					conflicts.push({
						type: "price_outlier",
						skuId,
						retailerItemId: row.retailer_item_id,
						severity: "warning",
						message: "Item price deviates by more than 50% from SKU median",
						details: {
							price,
							median: med,
							variance,
						},
					});
				}
			}
		}
	}

	log.info("Catalog conflict scan completed", {
		totalConflicts: conflicts.length,
		errorConflicts: conflicts.filter((item) => item.severity === "error").length,
	});

	return conflicts;
}

export function summarizeCatalogConflicts(conflicts: CatalogConflict[]): {
	total: number;
	byType: Record<string, number>;
} {
	const byType: Record<string, number> = {};
	for (const conflict of conflicts) {
		byType[conflict.type] = (byType[conflict.type] ?? 0) + 1;
	}
	return {
		total: conflicts.length,
		byType,
	};
}
