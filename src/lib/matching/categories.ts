/**
 * Category Normalization
 *
 * Maps ~48 raw retailer categories → ~12 normalized categories.
 * Handles Mojibake (Windows-1250→UTF-8 garbling), case differences,
 * and chain-specific subcategory conventions (e.g. DM).
 */

import { removeDiacritics, normalizeWhitespace } from "./normalize";

export interface NormalizedCategory {
	category: string;
	subcategory: string | null;
}

interface CategoryRule {
	patterns: string[];
	category: string;
	subcategory?: string | null;
}

/**
 * Rules are evaluated in order. First match wins.
 * Patterns are matched against the lowercased, diacritics-stripped, whitespace-normalized input.
 *
 * Subcategory is preserved from raw if non-null, otherwise set from rule.
 */
const CATEGORY_RULES: CategoryRule[] = [
	// Piće
	{
		patterns: ["pice", "pica"],
		category: "Piće",
	},
	// Hrana
	{
		patterns: ["hrana", "prehrana"],
		category: "Hrana",
	},
	// Sredstva za čišćenje
	{
		patterns: ["sredstva za ciscenje", "sredstva za ci"],
		category: "Sredstva za čišćenje",
	},
	// Kućanstvo / proizvodi za kućanstvo
	{
		patterns: ["kucanstvo", "proizvodi za ku"],
		category: "Kućanstvo",
	},
	// Toaletne potrepštine
	{
		patterns: ["toaletne potrep"],
		category: "Toaletne potrepštine",
	},
	// Bebe i djeca
	{
		patterns: ["bebe", "djeca"],
		category: "Bebe i djeca",
	},
	// Zdravlje (DM subcategory)
	{
		patterns: ["zdravlje"],
		category: "Zdravlje",
	},
	// Kozmetika — catch-all for various cosmetics subcategories
	{
		patterns: ["dekorativna kozmetika"],
		category: "Kozmetika",
		subcategory: "Dekorativna kozmetika",
	},
	{
		patterns: ["lice"],
		category: "Kozmetika",
		subcategory: "Lice",
	},
	{
		patterns: ["kosa"],
		category: "Kozmetika",
		subcategory: "Kosa",
	},
	{
		patterns: ["tijelo"],
		category: "Kozmetika",
		subcategory: "Tijelo",
	},
	{
		patterns: ["kozmetika"],
		category: "Kozmetika",
	},
];

/**
 * Normalize raw category (and optionally raw subcategory) to a standard category/subcategory pair.
 *
 * @param rawCategory - The raw category string from the retailer
 * @param rawSubcategory - The raw subcategory string, if any
 * @returns Normalized category and subcategory, or null if no mapping found
 */
export function normalizeCategory(
	rawCategory: string | null,
	rawSubcategory?: string | null,
): NormalizedCategory | null {
	if (!rawCategory) return null;

	// Clean: strip Mojibake replacement chars, normalize
	const cleaned = rawCategory.replace(/\uFFFD/g, "");
	const normalized = normalizeWhitespace(
		removeDiacritics(cleaned.toLowerCase()),
	);

	for (const rule of CATEGORY_RULES) {
		for (const pattern of rule.patterns) {
			if (normalized.includes(pattern)) {
				return {
					category: rule.category,
					// Preserve existing non-null subcategory; otherwise use rule's subcategory
					subcategory: rawSubcategory || rule.subcategory || null,
				};
			}
		}
	}

	return null;
}
