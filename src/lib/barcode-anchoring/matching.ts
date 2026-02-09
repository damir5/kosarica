import type { BarcodeClass, BarcodeCluster, BarcodeSourceRow } from "./types";

function sanitizeBarcode(raw: string): string {
	return raw.replace(/\D+/g, "");
}

function isValidEan(barcode: string, length: 8 | 13): boolean {
	if (barcode.length !== length || !/^\d+$/.test(barcode)) {
		return false;
	}

	const digits = barcode.split("").map((digit) => Number.parseInt(digit, 10));
	const checkDigit = digits[length - 1] ?? 0;
	let sum = 0;

	for (let i = 0; i < length - 1; i += 1) {
		const weight = (length - 1 - i) % 2 === 0 ? 1 : 3;
		sum += (digits[i] ?? 0) * weight;
	}

	const expected = (10 - (sum % 10)) % 10;
	return expected === checkDigit;
}

export function validateBarcode(barcode: string): boolean {
	const normalized = sanitizeBarcode(barcode);
	return isValidEan(normalized, 13) || isValidEan(normalized, 8);
}

export function classifyBarcode(barcode: string): BarcodeClass {
	const normalized = sanitizeBarcode(barcode);
	if (!/^\d+$/.test(normalized)) {
		return "unknown";
	}

	if (normalized.length === 13) {
		const prefix = Number.parseInt(normalized.slice(0, 2), 10);
		if (prefix >= 20 && prefix <= 29) {
			return "variable_weight";
		}
		return isValidEan(normalized, 13) ? "valid_ean13" : "internal_code";
	}

	if (normalized.length === 8) {
		return isValidEan(normalized, 8) ? "valid_ean8" : "internal_code";
	}

	return "unknown";
}

export function groupByBarcode(rows: BarcodeSourceRow[]): Map<string, BarcodeCluster> {
	const byBarcode = new Map<string, BarcodeCluster>();

	for (const row of rows) {
		const barcode = sanitizeBarcode(row.barcode);
		if (barcode.length === 0) {
			continue;
		}

		const barcodeClass = classifyBarcode(barcode);
		const existing = byBarcode.get(barcode);
		if (!existing) {
			byBarcode.set(barcode, {
				barcode,
				barcodeClass,
				items: [
					{
						retailerItemId: row.retailerItemId,
						chainSlug: row.chainSlug,
						name: row.name,
						category: row.category,
						totalAmount: row.totalAmount,
						extractedUnit: row.extractedUnit,
					},
				],
				chainCount: row.chainSlug ? 1 : 0,
				itemCount: 1,
				categoryAgreement: 0,
				quantityAgreement: 0,
				priceVariance: null,
				priorityScore: 0,
			});
			continue;
		}

		existing.items.push({
			retailerItemId: row.retailerItemId,
			chainSlug: row.chainSlug,
			name: row.name,
			category: row.category,
			totalAmount: row.totalAmount,
			extractedUnit: row.extractedUnit,
		});
		existing.itemCount = existing.items.length;
		existing.chainCount = new Set(
			existing.items
				.map((item) => item.chainSlug)
				.filter((chain): chain is string => chain != null),
		).size;
	}

	return byBarcode;
}
