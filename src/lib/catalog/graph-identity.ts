import {
	normalizeProductName,
	normalizeWhitespace,
	removeDiacritics,
} from "@/lib/matching/normalize";

export type CatalogIdentitySourceRow = {
	id: string;
	name: string;
	brand: string | null;
	category: string | null;
	subcategory: string | null;
	imageUrl: string | null;
	normalizedUnit: string | null;
	normalizedQuantity: number | null;
	featureEverydayName: string | null;
	featureProductType: string | null;
	featureVariant: string | null;
	featureBrand: string | null;
	featureExtractedUnit: string | null;
	featureTotalAmount: number | null;
	featurePackAmount: number | null;
	featureContainerType: string | null;
};

export type DerivedFamilyIdentity = {
	displayName: string;
	familyKey: string;
	familyGroupKey: string;
	taxonomy: string | null;
	familyKind: "standard" | "commodity" | "fresh" | "branded" | "private_label";
	brandGroup: string | null;
	coreName: string | null;
	qualityLabel: string | null;
	imageUrl: string | null;
};

export type DerivedVariantIdentity = {
	displayName: string;
	variantKey: string;
	packLabel: string | null;
	normalizedUnit: string | null;
	normalizedQuantity: number | null;
	packCount: number;
	containerType: string | null;
	imageUrl: string | null;
};

const QUALITY_MARKERS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /\bbio\b|\beko\b|\borganic\b|\borganski\b/, label: "Bio" },
	{ pattern: /\bzero\b/, label: "Zero" },
	{ pattern: /\bmax\b/, label: "Max" },
	{ pattern: /\bultra\b/, label: "Ultra" },
	{ pattern: /\bplatinum\b/, label: "Platinum" },
	{ pattern: /\bsensitive\b/, label: "Sensitive" },
	{ pattern: /\ball in one\b|\ballin1\b|\baio\b/, label: "All in One" },
	{ pattern: /\bclassic\b|\boriginal\b/, label: "Original" },
];

const FRESH_TAXONOMY_PATTERNS = [
	"voce",
	"voce i povrce",
	"povrce",
	"meso",
	"janjetina",
	"teletina",
	"svinjetina",
	"piletina",
	"riba",
];

const CONTAINER_NOISE = [
	"pet",
	"boca",
	"limenka",
	"can",
	"box",
	"pak",
	"paket",
	"kom",
	"tableta",
	"tablete",
	"tabs",
	"caps",
	"kapsule",
	"jar",
	"vreca",
	"vrecica",
];

const QUALITY_MARKER_PATTERNS = QUALITY_MARKERS.map(
	(marker) =>
		new RegExp(
			marker.pattern.source,
			marker.pattern.flags.includes("g")
				? marker.pattern.flags
				: `${marker.pattern.flags}g`,
		),
);

export function toTitleCase(value: string): string {
	return value
		.split(" ")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function slugify(value: string): string {
	return normalizeProductName(value).replace(/\s+/g, "-").slice(0, 96);
}

export function stripQualityMarkers(value: string): string {
	let stripped = normalizeWhitespace(value);
	for (const pattern of QUALITY_MARKER_PATTERNS) {
		stripped = normalizeWhitespace(stripped.replace(pattern, " "));
	}
	return stripped;
}

function cleanNullable(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const trimmed = normalizeWhitespace(value);
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeTokenValue(value: string | null | undefined): string | null {
	const cleaned = cleanNullable(value);
	if (!cleaned) {
		return null;
	}
	return normalizeProductName(cleaned);
}

function looksFreshTaxonomy(value: string | null): boolean {
	if (!value) {
		return false;
	}
	const normalized = normalizeProductName(value);
	return FRESH_TAXONOMY_PATTERNS.some((token) => normalized.includes(token));
}

function detectQualityLabel(
	values: Array<string | null | undefined>,
): string | null {
	const joined = normalizeProductName(values.filter(Boolean).join(" "));
	for (const marker of QUALITY_MARKERS) {
		if (marker.pattern.test(joined)) {
			return marker.label;
		}
	}
	return null;
}

function stripQuantityNoise(value: string): string {
	return normalizeWhitespace(
		value
			.replace(
				/\b\d+\s*[xX×]\s*\d+[.,]?\d*\s*(kg|g|gr|l|lt|lit|ltr|ml|kom|pcs)\b/giu,
				" ",
			)
			.replace(/\b\d+[.,]?\d*\s*(kg|g|gr|l|lt|lit|ltr|ml|kom|pcs)\b/giu, " ")
			.replace(/\b\d+\/\d+\b/gu, " ")
			.replace(/\b\d+\b/gu, " "),
	);
}

function stripContainerNoise(value: string): string {
	let stripped = value;
	for (const token of CONTAINER_NOISE) {
		stripped = stripped.replace(new RegExp(`\\b${token}\\b`, "giu"), " ");
	}
	return normalizeWhitespace(stripped);
}

function normalizeBrandGroup(
	row: CatalogIdentitySourceRow,
	isFresh: boolean,
): string | null {
	if (isFresh) {
		return null;
	}
	return cleanNullable(row.featureBrand ?? row.brand);
}

function deriveTaxonomy(row: CatalogIdentitySourceRow): string | null {
	return cleanNullable(
		row.featureProductType ?? row.category ?? row.subcategory,
	);
}

function deriveBaseLabel(
	row: CatalogIdentitySourceRow,
	isFresh: boolean,
): string {
	const everydayName = cleanNullable(row.featureEverydayName);
	const featureVariant = cleanNullable(row.featureVariant);
	const brandGroup = normalizeBrandGroup(row, isFresh);
	const rawName = stripContainerNoise(
		stripQuantityNoise(removeDiacritics(cleanNullable(row.name) ?? row.name)),
	);

	if (isFresh) {
		const freshBase = everydayName ?? rawName;
		const extra =
			featureVariant &&
			!normalizeProductName(freshBase).includes(
				normalizeProductName(featureVariant),
			)
				? featureVariant
				: null;
		return normalizeWhitespace([freshBase, extra].filter(Boolean).join(" "));
	}

	if (everydayName) {
		const display = normalizeWhitespace(
			[
				brandGroup &&
				!normalizeProductName(everydayName).includes(
					normalizeProductName(brandGroup),
				)
					? brandGroup
					: null,
				everydayName,
				featureVariant,
			]
				.filter(Boolean)
				.join(" "),
		);
		if (display.length > 0) {
			return display;
		}
	}

	if (
		brandGroup &&
		!normalizeProductName(rawName).includes(normalizeProductName(brandGroup))
	) {
		return normalizeWhitespace(`${brandGroup} ${rawName}`);
	}

	return rawName;
}

function buildPackLabel(params: {
	quantity: number | null;
	unit: string | null;
	packCount: number;
	containerType: string | null;
}): string | null {
	const quantity = params.quantity;
	const unit = cleanNullable(params.unit);
	const packCount = params.packCount > 0 ? params.packCount : 1;
	const pieces = [];
	if (quantity != null && Number.isFinite(quantity) && quantity > 0 && unit) {
		const amount = Number.isInteger(quantity)
			? String(quantity)
			: quantity.toFixed(2).replace(/\.?0+$/, "");
		pieces.push(
			packCount > 1 ? `${packCount}x${amount} ${unit}` : `${amount} ${unit}`,
		);
	} else if (packCount > 1) {
		pieces.push(`${packCount} kom`);
	}
	if (params.containerType) {
		pieces.push(params.containerType);
	}
	const label = normalizeWhitespace(pieces.join(" "));
	return label.length > 0 ? label : null;
}

export function deriveFamilyIdentity(
	row: CatalogIdentitySourceRow,
): DerivedFamilyIdentity {
	const taxonomy = deriveTaxonomy(row);
	const isFresh = looksFreshTaxonomy(taxonomy);
	const brandGroup = normalizeBrandGroup(row, isFresh);
	const qualityLabel = detectQualityLabel([
		row.name,
		row.featureEverydayName,
		row.featureVariant,
	]);
	const baseLabel = deriveBaseLabel(row, isFresh);
	const normalizedBase = normalizeProductName(baseLabel);
	const normalizedQuality = qualityLabel
		? normalizeProductName(qualityLabel)
		: null;
	const baseWithoutQuality =
		normalizedQuality && normalizedBase.includes(normalizedQuality)
			? normalizeWhitespace(
					normalizedBase.replace(
						new RegExp(`\\b${normalizedQuality}\\b`, "gu"),
						" ",
					),
				)
			: normalizedBase;

	const displayName = toTitleCase(
		normalizeWhitespace(
			[
				baseLabel,
				qualityLabel &&
				!normalizedBase.includes(normalizeProductName(qualityLabel))
					? qualityLabel
					: null,
			]
				.filter(Boolean)
				.join(" "),
		),
	);

	const familyKind = isFresh ? "fresh" : brandGroup ? "branded" : "commodity";

	const familyKey = [
		normalizeTokenValue(taxonomy) ?? "uncategorized",
		normalizeTokenValue(brandGroup) ?? "generic",
		normalizeTokenValue(displayName) ?? "unnamed",
	].join("|");

	return {
		displayName,
		familyKey,
		familyGroupKey: [
			normalizeTokenValue(taxonomy) ?? "uncategorized",
			normalizeTokenValue(brandGroup) ?? "generic",
			baseWithoutQuality || normalizeTokenValue(displayName) || "unnamed",
		].join("|"),
		taxonomy,
		familyKind,
		brandGroup,
		coreName:
			cleanNullable(row.featureEverydayName) ?? toTitleCase(baseWithoutQuality),
		qualityLabel,
		imageUrl: row.imageUrl,
	};
}

export function deriveVariantIdentity(
	row: CatalogIdentitySourceRow,
	family: DerivedFamilyIdentity,
): DerivedVariantIdentity {
	const quantity = row.featureTotalAmount ?? row.normalizedQuantity ?? null;
	const unit = cleanNullable(row.featureExtractedUnit ?? row.normalizedUnit);
	const packCount =
		row.featurePackAmount != null && row.featurePackAmount > 0
			? row.featurePackAmount
			: 1;
	const containerType = cleanNullable(row.featureContainerType);
	const packLabel = buildPackLabel({
		quantity,
		unit,
		packCount,
		containerType,
	});
	const displayName = normalizeWhitespace(
		[family.displayName, packLabel].filter(Boolean).join(" "),
	);
	return {
		displayName,
		variantKey: [
			family.familyKey,
			unit ?? "unitless",
			quantity != null ? String(quantity) : "na",
			String(packCount),
			normalizeTokenValue(containerType) ?? "none",
		].join("|"),
		packLabel,
		normalizedUnit: unit,
		normalizedQuantity: quantity,
		packCount,
		containerType,
		imageUrl: row.imageUrl ?? family.imageUrl,
	};
}
