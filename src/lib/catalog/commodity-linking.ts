import { and, eq, inArray, isNull } from "drizzle-orm";
import {
	canonicalSkus,
	retailerItemFeatures,
	retailerItems,
	skuItemLinks,
} from "@/db/schema";
import {
	normalizeProductName,
	normalizeWhitespace,
} from "@/lib/matching/normalize";
import { getDb } from "@/utils/bindings";

type CommodityVariantRule = {
	aliases: string[];
	label: string;
};

type CommodityRule = {
	baseName: string;
	productType: string;
	aliases: string[];
	excludeAliases?: string[];
	allowedNameTokens?: string[];
	variants?: CommodityVariantRule[];
};

export type CommodityClassificationInput = {
	name: string;
	category: string | null;
	subcategory: string | null;
	normalizedUnit: string | null;
	normalizedQuantity: number | null;
	featureCategory: string | null;
	featureEverydayName: string | null;
	featureProductType: string | null;
	featureVariant: string | null;
	featureExtractedUnit: string | null;
	featureTotalAmount: number | null;
};

export type CommodityCandidate = {
	baseName: string;
	productType: string;
	variantName: string | null;
	normalizedQuantity: number | null;
};

type SkuLookupResult = {
	id: string;
	created: boolean;
};

const ORGANIC_MARKERS = [" bio ", " eko ", " organic ", " organski ", " kbio "];
const LOOSE_MARKERS = [" rfz ", " rfs ", " rinfuza ", " rinfuz "];
const PRODUCE_CONTEXT_KEYWORDS = [
	" voce ",
	" voće ",
	" povrce ",
	" povrće ",
	" svjeze ",
	" svježe ",
	" voce i povrce ",
	" voće i povrće ",
];
const PROCESSED_PHRASES = [
	"caj",
	"tea",
	"bombon",
	"bomboni",
	"beer",
	"ale",
	"ginger beer",
	"ginger ale",
	"sok",
	"napitak",
	"kombucha",
	"kombuha",
	"shot",
	"cider",
	"liker",
	"gin",
	"pivo",
	"zvaka",
	"zvakaca",
	"sampon",
	"gel",
	"sapun",
	"sushi",
	"umak",
	"ukiseljen",
	"pire",
	"kocke",
	"listici",
	"suhi",
	"u prahu",
	"u granulama",
	"u octu",
	"u acetu",
	"prilog",
	"cokolada",
	"kefir",
	"dezodorans",
	"etericno",
	"ulje",
	"kapsule",
	"dodatak prehrani",
	"sirup",
	"ocat",
	"dzem",
	"marmelada",
	"kolac",
	"keks",
	"bruschette",
	"bake rolls",
	"prepecenac",
	"instant tjest",
	"juha",
	"jušne",
	"pesto",
	"namaz",
	"drazeje",
];
const PROCESSED_STEMS = [
	"fermentir",
	"kandiran",
	"usecer",
	"šećer",
	"mljeven",
	"granul",
	"sjeckan",
	"rezan",
	"narezan",
	"guljen",
	"kuhan",
	"ukiselj",
	"komad",
	"kockic",
	"listic",
	"prah",
];
const NON_PRODUCE_CONTEXT_KEYWORDS = [
	"kozmet",
	"ljepot",
	"higijen",
	"kucanstv",
	"ciscenj",
	"ljekarn",
	"suplement",
	"dodatak",
	"pice",
	"napit",
	"alkohol",
	"zacin",
	"začin",
	"zacini",
	"začini",
	"slatkis",
	"slatkiš",
	"slatkisi",
	"slatkiši",
	"bombon",
	"bomboni",
	"grick",
	"peciv",
	"pekar",
	"kruh",
	"mlij",
	"sir",
	"mes",
	"kobasic",
	"riba",
	"tjesten",
	"umak",
	"umaci",
	"konzerv",
	"delikates",
];
const GENERIC_ALLOWED_NAME_TOKENS = [
	"domaci",
	"domaca",
	"domace",
	"solo",
	"esp",
	"mr",
	"pt",
	"vh",
	"snizeni",
	"snizeno",
	"akcija",
	"kom",
	"komad",
	"komadi",
	"vc",
	"mc",
];

const COMMODITY_RULES: CommodityRule[] = [
	{ baseName: "Đumbir", productType: "povrće", aliases: ["djumbir", "ginger"] },
	{ baseName: "Banana", productType: "voće", aliases: ["banana", "banane"] },
	{ baseName: "Limun", productType: "voće", aliases: ["limun"] },
	{ baseName: "Naranča", productType: "voće", aliases: ["naranca", "narance"] },
	{ baseName: "Mrkva", productType: "povrće", aliases: ["mrkva", "mrkve"] },
	{
		baseName: "Krumpir",
		productType: "povrće",
		aliases: ["krumpir", "krumpira"],
	},
	{
		baseName: "Češnjak",
		productType: "povrće",
		aliases: ["cesnjak", "bijeli luk"],
		excludeAliases: ["crni cesnjak"],
		allowedNameTokens: ["domaci", "domaca", "domace", "solo", "mladi", "crveni"],
	},
	{
		baseName: "Luk",
		productType: "povrće",
		aliases: ["luk", "zuti luk", "luk zuti", "kapula"],
		excludeAliases: [
			"bijeli luk",
			"mladi luk",
			"luk mladi",
			"zeleni luk",
			"luk zeleni",
			"vlasac",
			"srebrenac",
			"srebrni luk",
			"luk srebrni",
			"salot",
			"chalota",
			"echalion",
			"chata",
		],
		variants: [
			{
				aliases: [
					"crveni luk",
					"ljubicasti luk",
					"luk crveni",
					"luk ljubicasti",
					"ljubicasti",
					"lila",
					"luk lila",
				],
				label: "Crveni",
			},
		],
	},
];

function normalizeCategory(value: string | null): string | null {
	if (!value) {
		return null;
	}
	return normalizeProductName(value);
}

function normalizeJoined(values: Array<string | null | undefined>): string {
	const joined = values
		.map((value) => value?.trim())
		.filter((value): value is string => Boolean(value))
		.join(" ");
	return ` ${normalizeProductName(joined)} `;
}

function cleanCommodityName(name: string): string {
	let cleaned = ` ${normalizeProductName(name)} `;
	cleaned = cleaned.replace(/\b(kbio|bio|eko|organic|organski)\b/g, " ");
	cleaned = cleaned.replace(/\b(rfz|rfs|rinfuza|rinfuz|np)\b/g, " ");
	cleaned = cleaned.replace(/\b(komadi|komad|snizeni|snizeno|akcija)\b/g, " ");
	return ` ${normalizeWhitespace(cleaned)} `;
}

function isOrganicName(name: string): boolean {
	const normalized = ` ${normalizeProductName(name)} `;
	return ORGANIC_MARKERS.some((marker) => normalized.includes(marker));
}

function hasKeyword(normalizedText: string, keywords: string[]): boolean {
	return keywords.some((keyword) => normalizedText.includes(` ${keyword} `));
}

function hasStemKeyword(normalizedText: string, stems: string[]): boolean {
	return stems.some((stem) =>
		new RegExp(`\\b${escapeRegExp(stem)}\\w*\\b`).test(normalizedText),
	);
}

function matchesAlias(normalizedText: string, alias: string): boolean {
	return normalizedText.includes(` ${alias} `);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasProduceContext(normalizedContext: string): boolean {
	return PRODUCE_CONTEXT_KEYWORDS.some((keyword) =>
		normalizedContext.includes(keyword),
	);
}

function removeKeywordPhrases(text: string, values: string[]): string {
	let next = text;
	const sorted = [...values].sort((a, b) => b.length - a.length);
	for (const value of sorted) {
		next = next.replace(new RegExp(`\\b${escapeRegExp(value)}\\b`, "g"), " ");
	}
	return next;
}

function stripBareCommodityName(
	cleanedName: string,
	rule: CommodityRule,
	matchedVariant: CommodityVariantRule | undefined,
): string {
	let remaining = cleanedName;

	remaining = removeKeywordPhrases(remaining, rule.aliases);
	if (rule.excludeAliases) {
		remaining = removeKeywordPhrases(remaining, rule.excludeAliases);
	}
	if (matchedVariant) {
		remaining = removeKeywordPhrases(remaining, matchedVariant.aliases);
	}

	remaining = remaining.replace(
		/\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|kom|komad|komadi)?\b/g,
		" ",
	);
	remaining = removeKeywordPhrases(remaining, [
		...GENERIC_ALLOWED_NAME_TOKENS,
		...(rule.allowedNameTokens ?? []),
	]);
	remaining = remaining.replace(/[()/.,+-]/g, " ");

	return normalizeWhitespace(remaining).trim();
}

function normalizeFeatureMeasurement(
	unit: string | null,
	quantity: number | null,
): { normalizedUnit: string | null; normalizedQuantity: number | null } {
	if (
		!unit ||
		quantity == null ||
		!Number.isFinite(quantity) ||
		quantity <= 0
	) {
		return {
			normalizedUnit: null,
			normalizedQuantity: null,
		};
	}

	const normalizedUnit = normalizeProductName(unit);
	if (normalizedUnit === "kg") {
		return { normalizedUnit: "kg", normalizedQuantity: quantity };
	}
	if (normalizedUnit === "g" || normalizedUnit === "gr") {
		return {
			normalizedUnit: "kg",
			normalizedQuantity: quantity / 1000,
		};
	}

	return {
		normalizedUnit,
		normalizedQuantity: quantity,
	};
}

export function classifyCommodityItem(
	item: CommodityClassificationInput,
): CommodityCandidate | null {
	const normalizedName = normalizeJoined([
		item.name,
		item.featureEverydayName,
		item.featureVariant,
	]);
	const normalizedDescriptors = normalizeJoined([
		item.name,
		item.featureEverydayName,
		item.featureVariant,
		item.featureProductType,
	]);
	const cleanedName = cleanCommodityName(
		[item.name, item.featureEverydayName, item.featureVariant]
			.filter(Boolean)
			.join(" "),
	);
	const normalizedContext = normalizeJoined([
		normalizeCategory(item.category),
		normalizeCategory(item.subcategory),
		normalizeCategory(item.featureCategory),
		normalizeCategory(item.featureProductType),
	]);
	const featureMeasurement = normalizeFeatureMeasurement(
		item.featureExtractedUnit,
		item.featureTotalAmount,
	);
	const normalizedUnit =
		item.normalizedUnit ?? featureMeasurement.normalizedUnit ?? null;
	const normalizedQuantity =
		item.normalizedQuantity ?? featureMeasurement.normalizedQuantity ?? null;
	const hasLooseMarker = LOOSE_MARKERS.some((marker) =>
		normalizedName.includes(marker),
	);

	if (hasKeyword(normalizedContext, NON_PRODUCE_CONTEXT_KEYWORDS)) {
		return null;
	}

	if (normalizedUnit && normalizedUnit !== "kg") {
		return null;
	}

	if (
		hasKeyword(normalizedDescriptors, PROCESSED_PHRASES) ||
		hasStemKeyword(normalizedDescriptors, PROCESSED_STEMS)
	) {
		return null;
	}

	const rule = COMMODITY_RULES.find((candidate) => {
		if (
			candidate.excludeAliases?.some((alias) =>
				matchesAlias(cleanedName, alias),
			)
		) {
			return false;
		}

		return candidate.aliases.some((alias) => matchesAlias(cleanedName, alias));
	});
	if (!rule) {
		return null;
	}

	const variantParts: string[] = [];
	const matchedVariant = rule.variants?.find((variant) =>
		variant.aliases.some((alias) => matchesAlias(cleanedName, alias)),
	);
	if (matchedVariant) {
		variantParts.push(matchedVariant.label);
	}

	const bareCommodityRemainder = stripBareCommodityName(
		cleanedName,
		rule,
		matchedVariant,
	);
	const hasBareCommodityShape = bareCommodityRemainder.length === 0;
	const featureCommodityRemainder = item.featureEverydayName
		? stripBareCommodityName(
				cleanCommodityName(
					[item.featureEverydayName, item.featureVariant]
						.filter(Boolean)
						.join(" "),
				),
				rule,
				matchedVariant,
			)
		: null;
	const featureHasBareCommodityShape = featureCommodityRemainder === "";
	const hasFreshProduceSignal =
		hasProduceContext(normalizedContext) &&
		(hasBareCommodityShape || featureHasBareCommodityShape || hasLooseMarker);

	if (!hasFreshProduceSignal && !hasBareCommodityShape && !hasLooseMarker) {
		return null;
	}

	if (
		isOrganicName(
			[item.name, item.featureEverydayName, item.featureVariant]
				.filter(Boolean)
				.join(" "),
		)
	) {
		variantParts.push("Bio");
	}

	return {
		baseName: rule.baseName,
		productType: rule.productType,
		variantName:
			variantParts.length === 0 && hasLooseMarker
				? null
				: variantParts.length > 0
					? `${rule.baseName} ${variantParts.join(" ")}`
					: null,
		normalizedQuantity,
	};
}

async function getOrCreateBaseSku(params: {
	baseName: string;
	productType: string;
	cache: Map<string, string>;
}): Promise<SkuLookupResult> {
	const cached = params.cache.get(params.baseName);
	if (cached) {
		return { id: cached, created: false };
	}

	const db = getDb();
	const [existing] = await db
		.select({ id: canonicalSkus.id })
		.from(canonicalSkus)
		.where(
			and(
				eq(canonicalSkus.canonicalName, params.baseName),
				eq(canonicalSkus.isBaseProduct, true),
				isNull(canonicalSkus.mergedIntoId),
			),
		)
		.limit(1);

	if (existing) {
		params.cache.set(params.baseName, existing.id);
		return { id: existing.id, created: false };
	}

	const [created] = await db
		.insert(canonicalSkus)
		.values({
			canonicalName: params.baseName,
			everydayName: params.baseName,
			brand: null,
			productType: params.productType,
			normalizedUnit: "kg",
			normalizedQuantity: 1,
			packAmount: 1,
			containerType: null,
			isBaseProduct: true,
			matchPolicy: "matchable",
			status: "active",
			createdBy: null,
		})
		.returning({ id: canonicalSkus.id });

	params.cache.set(params.baseName, created.id);
	return { id: created.id, created: true };
}

async function getOrCreateVariantSku(params: {
	baseSkuId: string;
	variantName: string;
	productType: string;
	normalizedQuantity: number | null;
	cache: Map<string, string>;
}): Promise<SkuLookupResult> {
	const cacheKey = `${params.baseSkuId}:${params.variantName}`;
	const cached = params.cache.get(cacheKey);
	if (cached) {
		return { id: cached, created: false };
	}

	const db = getDb();
	const [existing] = await db
		.select({ id: canonicalSkus.id })
		.from(canonicalSkus)
		.where(
			and(
				eq(canonicalSkus.baseProductId, params.baseSkuId),
				eq(canonicalSkus.canonicalName, params.variantName),
				isNull(canonicalSkus.mergedIntoId),
			),
		)
		.limit(1);

	if (existing) {
		params.cache.set(cacheKey, existing.id);
		return { id: existing.id, created: false };
	}

	const [created] = await db
		.insert(canonicalSkus)
		.values({
			baseProductId: params.baseSkuId,
			canonicalName: params.variantName,
			everydayName: params.variantName,
			brand: null,
			productType: params.productType,
			normalizedUnit: "kg",
			normalizedQuantity: params.normalizedQuantity,
			packAmount: 1,
			containerType: null,
			isBaseProduct: false,
			matchPolicy: "matchable",
			status: "active",
			createdBy: null,
		})
		.returning({ id: canonicalSkus.id });

	params.cache.set(cacheKey, created.id);
	return { id: created.id, created: true };
}

export async function autoLinkCommodityItems(itemIds?: string[]): Promise<{
	linkedItems: number;
	removedItems: number;
	linkedRetailerItemIds: string[];
	createdSkus: number;
	affectedSkuIds: string[];
}> {
	const db = getDb();
	const itemFilter = itemIds?.length
		? inArray(retailerItems.id, itemIds)
		: isNull(retailerItems.mergedIntoId);

	const rows = await db
		.select({
			id: retailerItems.id,
			name: retailerItems.name,
			category: retailerItems.category,
			subcategory: retailerItems.subcategory,
			normalizedUnit: retailerItems.normalizedUnit,
			normalizedQuantity: retailerItems.normalizedQuantity,
			featureCategory: retailerItemFeatures.normalizedCategory,
			featureEverydayName: retailerItemFeatures.everydayName,
			featureProductType: retailerItemFeatures.productType,
			featureVariant: retailerItemFeatures.variant,
			featureExtractedUnit: retailerItemFeatures.extractedUnit,
			featureTotalAmount: retailerItemFeatures.totalAmount,
			existingCanonicalSkuId: skuItemLinks.canonicalSkuId,
			existingLinkType: skuItemLinks.linkType,
		})
		.from(retailerItems)
		.leftJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.leftJoin(skuItemLinks, eq(skuItemLinks.retailerItemId, retailerItems.id))
		.where(and(itemFilter, isNull(retailerItems.mergedIntoId)));

	if (rows.length === 0) {
		return {
			linkedItems: 0,
			removedItems: 0,
			linkedRetailerItemIds: [],
			createdSkus: 0,
			affectedSkuIds: [],
		};
	}

	const baseCache = new Map<string, string>();
	const variantCache = new Map<string, string>();
	const createdSkuIds = new Set<string>();
	const affectedSkuIds = new Set<string>();
	const changedRetailerItemIds = new Set<string>();
	let linkedItems = 0;
	let removedItems = 0;

	for (const row of rows) {
		const existingFeatureMatchSkuId =
			row.existingLinkType === "feature_match"
				? row.existingCanonicalSkuId
				: null;
		if (row.existingCanonicalSkuId && !existingFeatureMatchSkuId) {
			continue;
		}

		const candidate = classifyCommodityItem(row);
		if (!candidate) {
			if (existingFeatureMatchSkuId) {
				await db
					.delete(skuItemLinks)
					.where(
						and(
							eq(skuItemLinks.retailerItemId, row.id),
							eq(skuItemLinks.linkType, "feature_match"),
						),
					);
				affectedSkuIds.add(existingFeatureMatchSkuId);
				changedRetailerItemIds.add(row.id);
				removedItems += 1;
			}
			continue;
		}

		const baseSku = await getOrCreateBaseSku({
			baseName: candidate.baseName,
			productType: candidate.productType,
			cache: baseCache,
		});
		affectedSkuIds.add(baseSku.id);
		if (baseSku.created) {
			createdSkuIds.add(baseSku.id);
		}

		let targetSkuId = baseSku.id;
		if (candidate.variantName) {
			const variantSku = await getOrCreateVariantSku({
				baseSkuId: baseSku.id,
				variantName: candidate.variantName,
				productType: candidate.productType,
				normalizedQuantity: candidate.normalizedQuantity,
				cache: variantCache,
			});
			targetSkuId = variantSku.id;
			affectedSkuIds.add(variantSku.id);
			if (variantSku.created) {
				createdSkuIds.add(variantSku.id);
			}
		}

		if (existingFeatureMatchSkuId === targetSkuId) {
			continue;
		}

		if (existingFeatureMatchSkuId) {
			await db
				.update(skuItemLinks)
				.set({
					canonicalSkuId: targetSkuId,
					confidence: 0.95,
					createdBy: null,
					createdAt: new Date(),
				})
				.where(
					and(
						eq(skuItemLinks.retailerItemId, row.id),
						eq(skuItemLinks.linkType, "feature_match"),
					),
				);
			affectedSkuIds.add(existingFeatureMatchSkuId);
			changedRetailerItemIds.add(row.id);
			linkedItems += 1;
			continue;
		}

		const inserted = await db
			.insert(skuItemLinks)
			.values({
				canonicalSkuId: targetSkuId,
				retailerItemId: row.id,
				linkType: "feature_match",
				confidence: 0.95,
				createdBy: null,
				createdAt: new Date(),
			})
			.onConflictDoNothing({ target: skuItemLinks.retailerItemId })
			.returning({ retailerItemId: skuItemLinks.retailerItemId });

		if (inserted.length === 0) {
			continue;
		}

		linkedItems += inserted.length;
		changedRetailerItemIds.add(row.id);
	}

	return {
		linkedItems,
		removedItems,
		linkedRetailerItemIds: Array.from(changedRetailerItemIds),
		createdSkus: createdSkuIds.size,
		affectedSkuIds: Array.from(affectedSkuIds),
	};
}
