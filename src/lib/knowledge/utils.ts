import { normalizeWhitespace, removeDiacritics } from "@/lib/matching/normalize";

export function normalizeKnowledgeText(value: string): string {
	return normalizeWhitespace(removeDiacritics(value).toLowerCase());
}

export function sanitizeCanonicalPart(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/--+/g, "-");
}

export function parseLocalizedNumber(value: string): number {
	if (value.includes(",")) {
		// Croatian: dots are thousands separators, comma is decimal
		const normalized = value.replace(/\./g, "").replace(",", ".");
		return Number.parseFloat(normalized);
	}
	// English: dot is decimal separator
	return Number.parseFloat(value);
}

export function toCanonicalQuantity(value: number): string {
	if (!Number.isFinite(value)) {
		return "";
	}
	if (Number.isInteger(value)) {
		return String(value);
	}
	return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function escapeRegexLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
