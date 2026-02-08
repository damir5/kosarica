/**
 * Text preparation for BGE-M3 embeddings.
 *
 * BGE-M3 is multilingual and handles Croatian diacritics natively,
 * so we keep diacritics and only normalize whitespace.
 */

import { normalizeWhitespace } from "@/lib/matching/normalize";

/**
 * Prepare passage text from a product for embedding.
 * Combines name, brand, category, and unit info with whitespace normalization.
 */
export function preparePassageText(product: {
	name: string;
	brand?: string | null;
	variant?: string | null;
	category?: string | null;
	unit?: string | null;
	unitQuantity?: string | null;
}): string {
	const parts: string[] = [];

	if (product.name) {
		parts.push(product.name);
	}
	if (product.brand) {
		parts.push(product.brand);
	}
	if (product.variant) {
		parts.push(product.variant);
	}
	if (product.category) {
		parts.push(product.category);
	}
	if (product.unitQuantity || product.unit) {
		parts.push(`${product.unitQuantity ?? ""} ${product.unit ?? ""}`.trim());
	}

	return normalizeWhitespace(parts.join(" "));
}

/**
 * Prepare query text with BGE-M3 instruction prefix for asymmetric search.
 */
export function prepareQueryText(text: string): string {
	const normalized = normalizeWhitespace(text);
	return `Represent this sentence for searching relevant passages: ${normalized}`;
}
