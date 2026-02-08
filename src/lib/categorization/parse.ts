import { z } from "zod";
import { normalizeWhitespace } from "@/lib/matching/normalize";

export interface ParsedCategorization {
	itemId: string;
	everydayName: string | null;
	productType: string | null;
	brand: string | null;
	variant: string | null;
	searchTags: string[];
	extractedAmount: number | null;
	extractedUnit: string | null;
	packAmount: number | null;
	containerType: string | null;
	confidence: number;
}

interface ParseItemResult {
	itemId: string;
	parsed: ParsedCategorization | null;
}

const CATEGORIZATION_ITEM_SCHEMA = z
	.object({
		item_id: z.string().optional(),
		itemId: z.string().optional(),
		id: z.string().optional(),
		everyday_name: z.string().nullable().optional(),
		everydayName: z.string().nullable().optional(),
		product_type: z.string().nullable().optional(),
		productType: z.string().nullable().optional(),
		brand: z.string().nullable().optional(),
		variant: z.string().nullable().optional(),
		search_tags: z.array(z.string()).nullable().optional(),
		searchTags: z.array(z.string()).nullable().optional(),
		unit: z.string().nullable().optional(),
		amount: z.string().nullable().optional(),
		package_size: z.string().nullable().optional(),
		packageSize: z.string().nullable().optional(),
		container: z.string().nullable().optional(),
		confidence: z.number().nullable().optional(),
	})
	.passthrough();

const CATEGORIZATION_RESPONSE_SCHEMA = z
	.object({
		results: z.array(CATEGORIZATION_ITEM_SCHEMA),
	})
	.passthrough();

function normalizeNullableText(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = normalizeWhitespace(value);
	return normalized.length > 0 ? normalized : null;
}

function normalizeConfidence(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}
	if (value > 1) {
		return Math.max(0, Math.min(1, value / 100));
	}
	return Math.max(0, Math.min(1, value));
}

function parseCroatianNumber(raw: string): number | null {
	const normalized = raw.includes(",")
		? raw.replace(/\./g, "").replace(",", ".")
		: raw;
	const parsed = Number.parseFloat(normalized);
	return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUnit(raw: string | null): string | null {
	if (!raw) {
		return null;
	}
	const normalized = raw.trim().toLowerCase();
	switch (normalized) {
		case "g":
		case "kg":
		case "ml":
		case "l":
		case "kom":
			return normalized;
		case "gr":
			return "g";
		case "pcs":
		case "piece":
		case "pieces":
		case "komad":
		case "komada":
			return "kom";
		default:
			return null;
	}
}

function parseAmountAndUnit(input: {
	amountRaw: string | null;
	unitRaw: string | null;
}): { amount: number | null; unit: string | null } {
	const unit = normalizeUnit(input.unitRaw);
	const amountRaw = input.amountRaw;
	if (!amountRaw) {
		return { amount: null, unit };
	}

	const compact = amountRaw.trim().toLowerCase();
	const embeddedMatch = compact.match(
		/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|l|kom|komad|komada|pcs|piece|pieces)\b/i,
	);
	if (embeddedMatch) {
		return {
			amount: parseCroatianNumber(embeddedMatch[1]),
			unit: normalizeUnit(embeddedMatch[2]) ?? unit,
		};
	}

	return {
		amount: parseCroatianNumber(compact),
		unit,
	};
}

function parsePackageSize(raw: string | null): number | null {
	if (!raw) {
		return null;
	}
	const normalized = raw.trim().toLowerCase();
	const directMatch = normalized.match(/(\d+)\s*[x×]/);
	if (directMatch) {
		const parsed = Number.parseInt(directMatch[1], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}

	const slashMatch = normalized.match(/(\d+)\s*\/\s*1/);
	if (slashMatch) {
		const parsed = Number.parseInt(slashMatch[1], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}

	const numericMatch = normalized.match(/\d+/);
	if (!numericMatch) {
		return null;
	}
	const parsed = Number.parseInt(numericMatch[0], 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeContainer(raw: string | null): string | null {
	if (!raw) {
		return null;
	}
	const normalized = raw.trim().toLowerCase();
	if (normalized === "pet" || normalized === "pet boca") {
		return "pet";
	}
	if (normalized === "limenka" || normalized === "can") {
		return "limenka";
	}
	if (normalized === "staklo" || normalized === "glass") {
		return "staklo";
	}
	if (
		normalized === "tetrapak" ||
		normalized === "tetra pak" ||
		normalized === "carton"
	) {
		return "tetrapak";
	}
	if (normalized === "tuba" || normalized === "tube") {
		return "tuba";
	}
	return null;
}

function normalizeSearchTags(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	const dedup = new Set<string>();
	for (const value of raw) {
		if (typeof value !== "string") {
			continue;
		}
		const normalized = normalizeWhitespace(value);
		if (normalized.length === 0) {
			continue;
		}
		dedup.add(normalized);
		if (dedup.size >= 5) {
			break;
		}
	}
	return Array.from(dedup);
}

function resolveItemId(raw: z.infer<typeof CATEGORIZATION_ITEM_SCHEMA>): string | null {
	const itemId = raw.item_id ?? raw.itemId ?? raw.id;
	if (typeof itemId !== "string") {
		return null;
	}
	const normalized = itemId.trim();
	return normalized.length > 0 ? normalized : null;
}

function parseCategorizationItem(
	raw: z.infer<typeof CATEGORIZATION_ITEM_SCHEMA>,
): ParseItemResult {
	const itemId = resolveItemId(raw);
	if (!itemId) {
		return { itemId: "", parsed: null };
	}

	const amountAndUnit = parseAmountAndUnit({
		amountRaw: normalizeNullableText(raw.amount),
		unitRaw: normalizeNullableText(raw.unit),
	});

	return {
		itemId,
		parsed: {
			itemId,
			everydayName: normalizeNullableText(raw.everyday_name ?? raw.everydayName),
			productType: normalizeNullableText(raw.product_type ?? raw.productType),
			brand: normalizeNullableText(raw.brand),
			variant: normalizeNullableText(raw.variant),
			searchTags: normalizeSearchTags(raw.search_tags ?? raw.searchTags),
			extractedAmount: amountAndUnit.amount,
			extractedUnit: amountAndUnit.unit,
			packAmount: parsePackageSize(
				normalizeNullableText(raw.package_size ?? raw.packageSize),
			),
			containerType: normalizeContainer(normalizeNullableText(raw.container)),
			confidence: normalizeConfidence(raw.confidence),
		},
	};
}

export function parseCategorizationResponse(
	payload: unknown,
	expectedItemIds: Set<string>,
): Map<string, ParsedCategorization> {
	const parsedResponse = CATEGORIZATION_RESPONSE_SCHEMA.safeParse(payload);
	if (!parsedResponse.success) {
		throw new Error("Categorization response does not match expected schema");
	}

	const byId = new Map<string, ParsedCategorization>();
	for (const item of parsedResponse.data.results) {
		const parsed = parseCategorizationItem(item);
		if (!parsed.parsed) {
			continue;
		}
		if (!expectedItemIds.has(parsed.itemId)) {
			continue;
		}
		byId.set(parsed.itemId, parsed.parsed);
	}

	return byId;
}

function normalizeForComparison(value: string | null): string {
	if (!value) {
		return "";
	}
	return normalizeWhitespace(value).toLowerCase();
}

function compareNumber(a: number | null, b: number | null): boolean {
	if (a == null && b == null) {
		return true;
	}
	if (a == null || b == null) {
		return false;
	}
	return Math.abs(a - b) < 0.001;
}

export function categorizationsAgree(
	left: ParsedCategorization,
	right: ParsedCategorization,
): boolean {
	return (
		normalizeForComparison(left.everydayName) ===
			normalizeForComparison(right.everydayName) &&
		normalizeForComparison(left.productType) ===
			normalizeForComparison(right.productType) &&
		normalizeForComparison(left.brand) === normalizeForComparison(right.brand) &&
		normalizeForComparison(left.variant) ===
			normalizeForComparison(right.variant) &&
		compareNumber(left.extractedAmount, right.extractedAmount) &&
		normalizeForComparison(left.extractedUnit) ===
			normalizeForComparison(right.extractedUnit) &&
		(left.packAmount ?? null) === (right.packAmount ?? null) &&
		normalizeForComparison(left.containerType) ===
			normalizeForComparison(right.containerType)
	);
}
