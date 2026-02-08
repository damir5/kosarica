import type { FeatureMatchItem } from "./types";

function normalize(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : null;
}

function quantityBucket(quantity: number | null): string {
	if (quantity == null || quantity <= 0) {
		return "na";
	}
	const tolerance = Math.max(quantity * 0.1, 0.1);
	const bucket = Math.round(quantity / tolerance);
	return String(bucket);
}

export function buildBlockingKeys(item: FeatureMatchItem): string[] {
	const keys = new Set<string>();
	const brand = normalize(item.extractedBrand ?? item.brand) ?? "unknown";
	const category = normalize(item.normalizedCategory) ?? "unknown";
	const unit = normalize(item.extractedUnit) ?? "none";
	const productType = normalize(item.productType) ?? "unknown";
	const container = normalize(item.containerType) ?? "none";
	const qtyBucket = quantityBucket(item.totalAmount);

	keys.add(`brand:${brand}|category:${category}`);
	keys.add(`brand:${brand}|unit:${unit}|qty:${qtyBucket}`);
	keys.add(`type:${productType}|pack:${item.packAmount}|container:${container}`);

	return Array.from(keys);
}
