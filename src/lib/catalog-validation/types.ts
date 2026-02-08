export type CatalogConflictType =
	| "duplicate_item_link"
	| "price_outlier"
	| "category_mismatch"
	| "brand_conflict"
	| "variant_conflict";

export interface CatalogConflict {
	type: CatalogConflictType;
	skuId: string;
	retailerItemId?: string;
	severity: "warning" | "error";
	message: string;
	details: Record<string, unknown>;
}
