import { normalizeWhitespace, parseUnit, removeDiacritics } from "@/lib/matching/normalize";
import type { ParsedFeature, RetailerItemFeatureInput } from "./types";

const KNOWN_BRANDS = new Set([
	"podravka",
	"vindija",
	"dukat",
	"z bregov",
	"k-plus",
	"pik",
	"franck",
	"jamnica",
	"coca cola",
	"zvijezda",
	"ledo",
	"gavrilovic",
]);

const CONTAINER_PATTERNS: Array<[RegExp, string]> = [
	[/\blimenka\b|\bcan\b/i, "limenka"],
	[/\bpet\b|\bbottle\b/i, "pet"],
	[/\bstaklo\b|\bglass\b/i, "staklo"],
	[/\btetrapak\b|\bkarton\b|\bcarton\b|\bpak\s*juice\b/i, "tetrapak"],
	[/\btuba\b|\btube\b/i, "tuba"],
];

const MULTIPACK_RE = /(\d+)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|dag|dkg|l|lt|lit|ltr|ml|kom|pcs|komad)/i;
const PACK_COUNT_RE = /(\d+)\s*\/\s*1\b/;

function normalizeLower(value: string): string {
	return normalizeWhitespace(removeDiacritics(value.toLowerCase()));
}

function parseCroatianNumber(raw: string): number | null {
	const normalized = raw.includes(",")
		? raw.replace(/\./g, "").replace(",", ".")
		: raw;
	const value = Number.parseFloat(normalized);
	return Number.isFinite(value) ? value : null;
}

function detectContainerType(text: string): string | null {
	for (const [pattern, type] of CONTAINER_PATTERNS) {
		if (pattern.test(text)) {
			return type;
		}
	}
	return null;
}

function detectPackAmount(text: string): number {
	const multipack = MULTIPACK_RE.exec(text);
	if (multipack) {
		const count = Number.parseInt(multipack[1], 10);
		if (Number.isFinite(count) && count > 0) {
			return count;
		}
	}

	const pack = PACK_COUNT_RE.exec(text);
	if (pack) {
		const count = Number.parseInt(pack[1], 10);
		if (Number.isFinite(count) && count > 0) {
			return count;
		}
	}

	return 1;
}

function extractBrand(name: string, brand: string | null): string | null {
	if (brand && brand.trim().length > 0) {
		return normalizeLower(brand);
	}

	const normalized = normalizeLower(name);
	for (const known of KNOWN_BRANDS) {
		if (normalized.startsWith(`${known} `) || normalized === known) {
			return known;
		}
	}

	const firstToken = normalized.split(" ")[0] ?? "";
	return firstToken.length >= 3 ? firstToken : null;
}

function buildBlockingKeys(input: {
	category: string | null;
	brand: string | null;
	unit: string | null;
	totalAmount: number | null;
	normalizedName: string;
}): string[] {
	const keys = new Set<string>();
	const category = input.category ?? "uncategorized";
	const brand = input.brand ?? "unknown";
	const unit = input.unit ?? "none";
	const amountBucket =
		input.totalAmount == null ? "na" : String(Math.round(input.totalAmount * 100) / 100);
	const prefix = input.normalizedName.slice(0, 18);

	keys.add(`cat:${category}|brand:${brand}`);
	keys.add(`cat:${category}|unit:${unit}`);
	keys.add(`cat:${category}|amount:${amountBucket}|unit:${unit}`);
	keys.add(`name:${prefix}`);

	return Array.from(keys);
}

export function parseRetailerItemFeature(input: RetailerItemFeatureInput): ParsedFeature {
	const normalizedName = normalizeLower(input.name);
	const normalizedCategory = input.category ? normalizeLower(input.category) : null;
	const extractedBrand = extractBrand(input.name, input.brand);
	const baseParsed = parseUnit(input.unit, input.unitQuantity, input.name);
	const packAmount = detectPackAmount(`${input.name} ${input.unit ?? ""} ${input.unitQuantity ?? ""}`);
	const containerType = detectContainerType(input.name);

	let unitAmount: number | null = null;
	let totalAmount: number | null = null;
	let extractedAmount: number | null = null;
	let extractedUnit: string | null = null;

	if (baseParsed) {
		extractedUnit = baseParsed.unit;
		totalAmount = baseParsed.quantity;
		unitAmount = packAmount > 0 ? baseParsed.quantity / packAmount : baseParsed.quantity;
		extractedAmount = baseParsed.quantity;
	}

	const multipackMatch = MULTIPACK_RE.exec(input.name);
	if (multipackMatch && unitAmount == null) {
		const perUnit = parseCroatianNumber(multipackMatch[2]);
		if (perUnit != null) {
			unitAmount = perUnit;
		}
	}

	const isCountItem = extractedUnit === "kom";
	const isMultipack = packAmount > 1;
	const blockingKeys = buildBlockingKeys({
		category: normalizedCategory,
		brand: extractedBrand,
		unit: extractedUnit,
		totalAmount,
		normalizedName,
	});

	return {
		normalizedName,
		normalizedCategory,
		extractedBrand,
		extractedAmount,
		extractedUnit,
		isCountItem,
		isMultipack,
		packAmount,
		unitAmount,
		totalAmount,
		containerType,
		blockingKeys,
	};
}
