import {
	normalizeWhitespace,
	parseUnit,
	removeDiacritics,
} from "@/lib/matching/normalize";
import { resolveBrand } from "./brand-resolver";
import type { ExtractedAttributes, KnowledgeCatalog } from "./types";
import {
	normalizeKnowledgeText,
	parseLocalizedNumber,
	sanitizeCanonicalPart,
	toCanonicalQuantity,
} from "./utils";

export function extractProductAttributes(
	name: string,
	brand: string | null | undefined,
	category: string | null | undefined,
	catalog: KnowledgeCatalog,
): ExtractedAttributes {
	const normalizedName = normalizeKnowledgeText(name);
	const productType = determineProductType(normalizedName, category, catalog);
	const attributes = extractAttributes(normalizedName, category, catalog);
	const fallbackUnit = parseUnit(null, null, name);

	if (fallbackUnit && attributes.volumeValue == null && attributes.count == null) {
		if (fallbackUnit.unit === "kom") {
			attributes.count = Math.round(fallbackUnit.quantity);
		} else {
			attributes.volumeValue = fallbackUnit.quantity;
			attributes.volumeUnit = fallbackUnit.unit;
		}
	}

	const canonicalKey = productType
		? buildCanonicalKey(productType, attributes)
		: null;

	return {
		productType,
		canonicalKey,
		attributes,
		resolvedBrand: resolveBrand(brand, catalog),
	};
}

function determineProductType(
	normalizedName: string,
	category: string | null | undefined,
	catalog: KnowledgeCatalog,
): string | null {
	for (const ruleSet of getRuleSetsForCategory(category, catalog)) {
		for (const rule of ruleSet.productTypeRules) {
			const hasPositiveMatch = rule.patterns.some((pattern) =>
				pattern.test(normalizedName),
			);
			if (!hasPositiveMatch) {
				continue;
			}

			const hasNegativeMatch = rule.antiPatterns.some((pattern) =>
				pattern.test(normalizedName),
			);
			if (!hasNegativeMatch) {
				return rule.productType;
			}
		}
	}

	return null;
}

function extractAttributes(
	normalizedName: string,
	category: string | null | undefined,
	catalog: KnowledgeCatalog,
): ExtractedAttributes["attributes"] {
	const result: ExtractedAttributes["attributes"] = {};

	for (const ruleSet of getRuleSetsForCategory(category, catalog)) {
		for (const rule of ruleSet.attributeRules) {
			const match = rule.pattern.exec(normalizedName);
			if (!match) {
				continue;
			}

			const rawValue = match.groups?.[rule.targetGroup] ?? match[1];
			if (!rawValue) {
				continue;
			}
			const transformedValue = transformValue(rawValue, rule.transform);

			switch (rule.attribute) {
				case "fat_percent": {
					if (typeof transformedValue === "number") {
						result.fatPercent = transformedValue;
					}
					break;
				}
				case "volume": {
					if (typeof transformedValue === "number") {
						result.volumeValue = transformedValue;
					}
					const rawUnit = match.groups?.unit;
					if (rawUnit) {
						result.volumeUnit = normalizeVolumeUnit(rawUnit);
					}
					break;
				}
				case "packaging": {
					if (typeof transformedValue === "string") {
						result.packaging = transformedValue;
					}
					break;
				}
				case "grade": {
					if (typeof transformedValue === "string") {
						result.grade = normalizeWhitespace(transformedValue.toUpperCase());
					}
					break;
				}
				case "organic": {
					if (typeof transformedValue === "boolean") {
						result.organic = transformedValue;
					}
					break;
				}
				case "count": {
					if (typeof transformedValue === "number") {
						result.count = Math.round(transformedValue);
					}
					break;
				}
				case "multipack_count": {
					if (typeof transformedValue === "number") {
						result.multipackCount = Math.round(transformedValue);
					}
					break;
				}
				case "sparkling": {
					if (typeof transformedValue === "string") {
						result.sparkling = transformedValue;
					}
					break;
				}
				default:
					break;
			}
		}
	}

	return result;
}

function getRuleSetsForCategory(
	category: string | null | undefined,
	catalog: KnowledgeCatalog,
) {
	const categoryKey = mapCategoryToRuleSet(category);
	const ruleSets = [];

	if (categoryKey && catalog.extractionByCategory.has(categoryKey)) {
		ruleSets.push(catalog.extractionByCategory.get(categoryKey));
	}
	if (catalog.extractionByCategory.has("general")) {
		ruleSets.push(catalog.extractionByCategory.get("general"));
	}

	return ruleSets.filter((value): value is NonNullable<typeof value> => Boolean(value));
}

function mapCategoryToRuleSet(category: string | null | undefined): string | null {
	if (!category) {
		return null;
	}

	const normalized = normalizeKnowledgeText(removeDiacritics(category));
	if (normalized.includes("dairy") || normalized.includes("mlijeko")) {
		return "dairy";
	}
	if (normalized.includes("beverage") || normalized.includes("pice")) {
		return "beverages";
	}
	if (
		normalized.includes("staple") ||
		normalized.includes("hrana") ||
		normalized.includes("brasno") ||
		normalized.includes("jaja")
	) {
		return "staples";
	}
	if (["dairy", "beverages", "staples"].includes(normalized)) {
		return normalized;
	}
	return null;
}

function transformValue(
	rawValue: string,
	transform: "number" | "lowercase" | "boolean" | "raw",
): number | string | boolean | null {
	switch (transform) {
		case "number": {
			const parsed = parseLocalizedNumber(rawValue);
			return Number.isFinite(parsed) ? parsed : null;
		}
		case "lowercase":
			return normalizeKnowledgeText(rawValue);
		case "boolean": {
			const normalized = normalizeKnowledgeText(rawValue);
			return ["bio", "eko", "organic", "true", "da"].includes(normalized);
		}
		default:
			return rawValue;
	}
}

function normalizeVolumeUnit(rawUnit: string): string {
	const normalized = normalizeKnowledgeText(rawUnit);
	if (["lt", "lit", "ltr"].includes(normalized)) {
		return "l";
	}
	if (normalized === "gr") {
		return "g";
	}
	if (["pcs", "komad", "ko", "pz"].includes(normalized)) {
		return "kom";
	}
	return normalized;
}

function buildCanonicalKey(
	productType: string,
	attributes: ExtractedAttributes["attributes"],
): string {
	const parts = [sanitizeCanonicalPart(productType)];

	if (attributes.sparkling) {
		parts.push(sanitizeCanonicalPart(attributes.sparkling));
	}
	if (attributes.fatPercent != null) {
		parts.push(sanitizeCanonicalPart(toCanonicalQuantity(attributes.fatPercent)));
	}
	if (attributes.grade) {
		parts.push(sanitizeCanonicalPart(attributes.grade));
	}
	if (attributes.count != null) {
		parts.push(`${Math.round(attributes.count)}kom`);
	} else if (attributes.volumeValue != null && attributes.volumeUnit) {
		parts.push(
			`${toCanonicalQuantity(attributes.volumeValue)}${sanitizeCanonicalPart(attributes.volumeUnit)}`,
		);
	}
	if (attributes.packaging) {
		parts.push(sanitizeCanonicalPart(attributes.packaging));
	}

	return parts.filter(Boolean).join("-");
}
