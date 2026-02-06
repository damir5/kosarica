import { createHash } from "node:crypto";

/**
 * Shared normalization utilities for product name matching, unit parsing,
 * and dedup hash computation.
 */

export const CROATIAN_MAP: Array<[RegExp, string]> = [
	[/\u010d/g, "c"], // č
	[/\u010c/g, "C"], // Č
	[/\u0107/g, "c"], // ć
	[/\u0106/g, "C"], // Ć
	[/\u0111/g, "dj"], // đ
	[/\u0110/g, "Dj"], // Đ
	[/\u0161/g, "s"], // š
	[/\u0160/g, "S"], // Š
	[/\u017e/g, "z"], // ž
	[/\u017d/g, "Z"], // Ž
];

export function removeDiacritics(value: string): string {
	let result = value;
	for (const [pattern, replacement] of CROATIAN_MAP) {
		result = result.replace(pattern, replacement);
	}
	return result.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

export function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

/**
 * Normalize a product name for dedup hashing:
 * lowercase → removeDiacritics → normalizeWhitespace → strip punctuation
 */
export function normalizeProductName(name: string): string {
	let result = name.toLowerCase();
	result = removeDiacritics(result);
	result = normalizeWhitespace(result);
	// Strip punctuation but keep alphanumeric and whitespace
	result = result.replace(/[^\p{L}\p{N}\s]/gu, "");
	result = normalizeWhitespace(result);
	return result;
}

/**
 * Compute a SHA-256 hash of the normalized product name.
 * Used for dedup key when no externalId or barcode is available.
 * Returns null for empty/blank names to avoid silent collisions.
 */
export function computeNameHash(name: string): string | null {
	const normalized = normalizeProductName(name);
	if (normalized.length === 0) return null;
	return createHash("sha256").update(normalized).digest("hex");
}

// ============================================================================
// Confidence hierarchy for override protection
// ============================================================================

export const CONFIDENCE_RANK: Record<string, number> = {
	verified: 5,
	manual: 4,
	ai: 3,
	knowledge: 3,
	heuristic: 2,
	barcode: 2,
	auto: 1,
};

/**
 * Returns the numeric rank for a confidence value. Null/unknown = 0.
 */
export function confidenceRank(confidence: string | null | undefined): number {
	if (!confidence) return 0;
	return CONFIDENCE_RANK[confidence] ?? 0;
}

// ============================================================================
// Unit parsing
// ============================================================================

export interface ParsedUnit {
	unit: "kg" | "l" | "kom";
	quantity: number; // in base unit (500g → 0.5 kg)
}

const UNIT_MAP: Record<string, "kg" | "l" | "kom"> = {
	kg: "kg",
	g: "kg",
	gr: "kg",
	l: "l",
	lt: "l",
	lit: "l",
	ltr: "l",
	ml: "l",
	kom: "kom",
	ko: "kom",
	pz: "kom",
	pcs: "kom",
	"1komad": "kom",
	komad: "kom",
};

const UNIT_DIVISOR: Record<string, number> = {
	g: 1000,
	gr: 1000,
	ml: 1000,
};

/**
 * Parse a number string supporting both English and Croatian decimal conventions.
 * - If comma is present: treat dots as thousand separators, comma as decimal.
 * - If only dots: treat dot as decimal separator (English convention).
 */
function parseCroatianNumber(raw: string): number {
	if (raw.includes(",")) {
		// Croatian: strip dots (thousands), then comma → dot (decimal)
		const cleaned = raw.replace(/\./g, "").replace(",", ".");
		return Number.parseFloat(cleaned);
	}
	return Number.parseFloat(raw);
}

/**
 * Multi-pack regex: "6x330ml", "6 x 330 ml"
 */
const MULTIPACK_RE =
	/^(\d+)\s*[xX×]\s*(\d+[.,]?\d*)\s*(kg|g|gr|l|lt|lit|ltr|ml|kom)\b/i;

/**
 * Embedded quantity+unit in a single field: "500g", "1.5l", "1,5 kg"
 */
const EMBEDDED_QTY_UNIT_RE =
	/^(\d+[.,]?\d*)\s*(kg|g|gr|l|lt|lit|ltr|ml|kom|ko|pz|pcs|komad)\b/i;

/**
 * Extract quantity+unit from product name.
 */
const NAME_QTY_UNIT_RE = /(\d+[.,]?\d*)\s*(kg|g|gr|l|lt|lit|ltr|ml|kom)\b/i;

/**
 * Multi-pack in product name: "6x330ml"
 */
const NAME_MULTIPACK_RE =
	/(\d+)\s*[xX×]\s*(\d+[.,]?\d*)\s*(kg|g|gr|l|lt|lit|ltr|ml|kom)\b/i;

/**
 * Parse unit information from raw fields and product name.
 *
 * Priority:
 * 1. Explicit rawQty + rawUnit if present
 * 2. Embedded in rawUnit: "500g" → split number + unit
 * 3. Embedded in rawQty: "1.00 kg" → parse
 * 4. Extract from product name (including multi-pack)
 */
export function parseUnit(
	rawUnit: string | null,
	rawQty: string | null,
	productName: string,
): ParsedUnit | null {
	const trimUnit = rawUnit?.trim() ?? "";
	const trimQty = rawQty?.trim() ?? "";

	// Try explicit rawUnit + rawQty combination first
	if (trimUnit && trimQty) {
		const result = tryParseExplicit(trimQty, trimUnit);
		if (result) return result;
	}

	// Try rawQty with embedded unit: "1.00 kg", "500 G"
	if (trimQty) {
		const result = tryParseEmbedded(trimQty);
		if (result) return result;
	}

	// Try embedded in rawUnit: "500g", "1.5l"
	if (trimUnit) {
		// Check multi-pack first: "6x330ml"
		const multiMatch = MULTIPACK_RE.exec(trimUnit);
		if (multiMatch) {
			return buildMultipackResult(multiMatch[1], multiMatch[2], multiMatch[3]);
		}

		const result = tryParseEmbedded(trimUnit);
		if (result) return result;

		// Try unit alone (no quantity): "kg", "l", "kom"
		const unitKey = trimUnit.toLowerCase();
		const baseUnit = UNIT_MAP[unitKey];
		if (baseUnit && baseUnit === "kom") {
			return { unit: "kom", quantity: 1 };
		}
	}

	// Extract from product name
	const nameMulti = NAME_MULTIPACK_RE.exec(productName);
	if (nameMulti) {
		return buildMultipackResult(nameMulti[1], nameMulti[2], nameMulti[3]);
	}

	const nameMatch = NAME_QTY_UNIT_RE.exec(productName);
	if (nameMatch) {
		return buildQtyUnitResult(nameMatch[1], nameMatch[2]);
	}

	return null;
}

function tryParseExplicit(rawQty: string, rawUnit: string): ParsedUnit | null {
	// Strip unit suffix from rawQty if present: "1.00 kg" → "1.00"
	const qtyWithoutUnit = rawQty.replace(
		/\s*(kg|g|gr|l|lt|lit|ltr|ml|kom|ko|pz|pcs|komad)\s*$/i,
		"",
	);
	const qty = parseCroatianNumber(qtyWithoutUnit);
	if (!Number.isFinite(qty) || qty <= 0) return null;

	const unitKey = rawUnit.toLowerCase().replace(/\s+/g, "");
	const baseUnit = UNIT_MAP[unitKey];
	if (!baseUnit) return null;

	const divisor = UNIT_DIVISOR[unitKey] ?? 1;
	return { unit: baseUnit, quantity: qty / divisor };
}

function tryParseEmbedded(raw: string): ParsedUnit | null {
	const match = EMBEDDED_QTY_UNIT_RE.exec(raw);
	if (!match) return null;
	return buildQtyUnitResult(match[1], match[2]);
}

function buildQtyUnitResult(
	qtyStr: string,
	unitStr: string,
): ParsedUnit | null {
	const qty = parseCroatianNumber(qtyStr);
	if (!Number.isFinite(qty) || qty <= 0) return null;

	const unitKey = unitStr.toLowerCase();
	const baseUnit = UNIT_MAP[unitKey];
	if (!baseUnit) return null;

	const divisor = UNIT_DIVISOR[unitKey] ?? 1;
	return { unit: baseUnit, quantity: qty / divisor };
}

function buildMultipackResult(
	countStr: string,
	qtyStr: string,
	unitStr: string,
): ParsedUnit | null {
	const count = Number.parseInt(countStr, 10);
	const qty = parseCroatianNumber(qtyStr);
	if (!Number.isFinite(count) || count <= 0) return null;
	if (!Number.isFinite(qty) || qty <= 0) return null;

	const unitKey = unitStr.toLowerCase();
	const baseUnit = UNIT_MAP[unitKey];
	if (!baseUnit) return null;

	const divisor = UNIT_DIVISOR[unitKey] ?? 1;
	return { unit: baseUnit, quantity: (count * qty) / divisor };
}

/**
 * Calculate unit price in cents per 1 base unit (1kg, 1l, or 1 piece).
 */
export function calculateUnitPriceCents(
	priceCents: number,
	parsed: ParsedUnit,
): number {
	if (parsed.quantity <= 0) return 0;
	return Math.round(priceCents / parsed.quantity);
}
