import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDatabase, type DatabaseType } from "@/db";
import {
	familyRelations,
	offerVariantLinks,
	productFamilies,
	productVariants,
	retailerItemFeatures,
	retailerItems,
	smartCollectionMembers,
	smartCollections,
} from "@/db/schema";
import {
	normalizeProductName,
	normalizeWhitespace,
	removeDiacritics,
} from "@/lib/matching/normalize";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

type CatalogSourceRow = {
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

type DerivedFamilyIdentity = {
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

type DerivedVariantIdentity = {
	displayName: string;
	variantKey: string;
	packLabel: string | null;
	normalizedUnit: string | null;
	normalizedQuantity: number | null;
	packCount: number;
	containerType: string | null;
	imageUrl: string | null;
};

type SyncGraphResult = {
	familiesTouched: number;
	variantsTouched: number;
	offersLinked: number;
	collectionsTouched: number;
	relationsTouched: number;
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

function toTitleCase(value: string): string {
	return value
		.split(" ")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function slugify(value: string): string {
	return normalizeProductName(value).replace(/\s+/g, "-").slice(0, 96);
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

function detectQualityLabel(values: Array<string | null | undefined>): string | null {
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
			.replace(/\b\d+\s*[xX×]\s*\d+[.,]?\d*\s*(kg|g|gr|l|lt|lit|ltr|ml|kom|pcs)\b/giu, " ")
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

function normalizeBrandGroup(row: CatalogSourceRow, isFresh: boolean): string | null {
	if (isFresh) {
		return null;
	}
	return cleanNullable(row.featureBrand ?? row.brand);
}

function deriveTaxonomy(row: CatalogSourceRow): string | null {
	return cleanNullable(row.featureProductType ?? row.category ?? row.subcategory);
}

function deriveBaseLabel(row: CatalogSourceRow, isFresh: boolean): string {
	const everydayName = cleanNullable(row.featureEverydayName);
	const featureVariant = cleanNullable(row.featureVariant);
	const brandGroup = normalizeBrandGroup(row, isFresh);
	const rawName = stripContainerNoise(
		stripQuantityNoise(removeDiacritics(cleanNullable(row.name) ?? row.name)),
	);

	if (isFresh) {
		const freshBase = everydayName ?? rawName;
		const extra =
			featureVariant && !normalizeProductName(freshBase).includes(normalizeProductName(featureVariant))
				? featureVariant
				: null;
		return normalizeWhitespace([freshBase, extra].filter(Boolean).join(" "));
	}

	if (everydayName) {
		const display = normalizeWhitespace(
			[
				brandGroup &&
				!normalizeProductName(everydayName).includes(normalizeProductName(brandGroup))
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
		const amount =
			Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, "");
		pieces.push(packCount > 1 ? `${packCount}x${amount} ${unit}` : `${amount} ${unit}`);
	} else if (packCount > 1) {
		pieces.push(`${packCount} kom`);
	}
	if (params.containerType) {
		pieces.push(params.containerType);
	}
	const label = normalizeWhitespace(pieces.join(" "));
	return label.length > 0 ? label : null;
}

function deriveFamilyIdentity(row: CatalogSourceRow): DerivedFamilyIdentity {
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
	const normalizedQuality = qualityLabel ? normalizeProductName(qualityLabel) : null;
	const baseWithoutQuality =
		normalizedQuality && normalizedBase.includes(normalizedQuality)
			? normalizeWhitespace(
					normalizedBase.replace(new RegExp(`\\b${normalizedQuality}\\b`, "gu"), " "),
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

	const familyKind = isFresh
		? "fresh"
		: brandGroup
			? "branded"
			: "commodity";

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
		coreName: cleanNullable(row.featureEverydayName) ?? toTitleCase(baseWithoutQuality),
		qualityLabel,
		imageUrl: row.imageUrl,
	};
}

function deriveVariantIdentity(
	row: CatalogSourceRow,
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

async function upsertFamily(
	tx: DatabaseType,
	family: DerivedFamilyIdentity,
): Promise<string> {
	const [existing] = await tx
		.select({ id: productFamilies.id })
		.from(productFamilies)
		.where(eq(productFamilies.familyKey, family.familyKey))
		.limit(1);

	if (existing) {
		await tx
			.update(productFamilies)
			.set({
				slug: slugify(family.displayName),
				displayName: family.displayName,
				titleNormalized: normalizeProductName(family.displayName),
				familyGroupKey: family.familyGroupKey,
				taxonomy: family.taxonomy,
				familyKind: family.familyKind,
				brandGroup: family.brandGroup,
				coreName: family.coreName,
				qualityLabel: family.qualityLabel,
				imageUrl: family.imageUrl,
				status: "active",
				updatedAt: new Date(),
			})
			.where(eq(productFamilies.id, existing.id));
		return existing.id;
	}

	const [inserted] = await tx
		.insert(productFamilies)
		.values({
			familyKey: family.familyKey,
			slug: slugify(family.displayName),
			displayName: family.displayName,
			titleNormalized: normalizeProductName(family.displayName),
			familyGroupKey: family.familyGroupKey,
			taxonomy: family.taxonomy,
			familyKind: family.familyKind,
			brandGroup: family.brandGroup,
			coreName: family.coreName,
			qualityLabel: family.qualityLabel,
			imageUrl: family.imageUrl,
			status: "active",
		})
		.returning({ id: productFamilies.id });

	return inserted.id;
}

async function upsertVariant(
	tx: DatabaseType,
	familyId: string,
	variant: DerivedVariantIdentity,
): Promise<string> {
	const [existing] = await tx
		.select({ id: productVariants.id })
		.from(productVariants)
		.where(
			and(
				eq(productVariants.familyId, familyId),
				eq(productVariants.variantKey, variant.variantKey),
			),
		)
		.limit(1);

	if (existing) {
		await tx
			.update(productVariants)
			.set({
				displayName: variant.displayName,
				packLabel: variant.packLabel,
				normalizedUnit: variant.normalizedUnit,
				normalizedQuantity: variant.normalizedQuantity,
				packCount: variant.packCount,
				containerType: variant.containerType,
				imageUrl: variant.imageUrl,
				updatedAt: new Date(),
			})
			.where(eq(productVariants.id, existing.id));
		return existing.id;
	}

	const [inserted] = await tx
		.insert(productVariants)
		.values({
			familyId,
			variantKey: variant.variantKey,
			displayName: variant.displayName,
			packLabel: variant.packLabel,
			normalizedUnit: variant.normalizedUnit,
			normalizedQuantity: variant.normalizedQuantity,
			packCount: variant.packCount,
			containerType: variant.containerType,
			imageUrl: variant.imageUrl,
		})
		.returning({ id: productVariants.id });
	return inserted.id;
}

async function rebuildFamilyGroupRelations(
	tx: DatabaseType,
	familyGroupKeys: string[],
): Promise<number> {
	if (familyGroupKeys.length === 0) {
		return 0;
	}

	const families = await tx
		.select({
			id: productFamilies.id,
			familyGroupKey: productFamilies.familyGroupKey,
			qualityLabel: productFamilies.qualityLabel,
		})
		.from(productFamilies)
		.where(inArray(productFamilies.familyGroupKey, familyGroupKeys));

	const familyIds = families.map((family) => family.id);
	if (familyIds.length > 0) {
		await tx.delete(familyRelations).where(
			or(
				inArray(familyRelations.sourceFamilyId, familyIds),
				inArray(familyRelations.targetFamilyId, familyIds),
			),
		);
	}

	const grouped = new Map<string, typeof families>();
	for (const family of families) {
		const list = grouped.get(family.familyGroupKey) ?? [];
		list.push(family);
		grouped.set(family.familyGroupKey, list);
	}

	const rows = [];
	for (const group of grouped.values()) {
		for (let i = 0; i < group.length; i += 1) {
			for (let j = 0; j < group.length; j += 1) {
				if (i === j) {
					continue;
				}
				rows.push({
					id: generatePrefixedId("frl"),
					sourceFamilyId: group[i]?.id ?? "",
					targetFamilyId: group[j]?.id ?? "",
					relationType:
						group[i]?.qualityLabel !== group[j]?.qualityLabel
							? "quality_tier"
							: "formula_sibling",
					score: 0.9,
					source: "graph_sync",
				});
			}
		}
	}

	if (rows.length > 0) {
		await tx.insert(familyRelations).values(rows).onConflictDoNothing();
	}

	return rows.length;
}

async function ensureCollection(
	tx: DatabaseType,
	input: {
		ruleKey: string;
		title: string;
		collectionType: "taxonomy" | "brand" | "family_group";
		taxonomy?: string | null;
		brandGroup?: string | null;
	},
): Promise<string> {
	const slug = slugify(input.title);
	const existingRows = await tx
		.select({
			id: smartCollections.id,
			ruleKey: smartCollections.ruleKey,
			slug: smartCollections.slug,
		})
		.from(smartCollections)
		.where(
			or(
				eq(smartCollections.ruleKey, input.ruleKey),
				eq(smartCollections.slug, slug),
			),
		)
		.limit(5);

	const existingByRule = existingRows.find((row) => row.ruleKey === input.ruleKey);
	const existingBySlug = existingRows.find((row) => row.slug === slug);
	const existing = existingByRule ?? existingBySlug;

	if (existing) {
		await tx
			.update(smartCollections)
			.set({
				slug,
				title: input.title,
				collectionType: input.collectionType,
				taxonomy: input.taxonomy ?? null,
				brandGroup: input.brandGroup ?? null,
				status: "active",
				updatedAt: new Date(),
			})
			.where(eq(smartCollections.id, existing.id));
		return existing.id;
	}

	const [inserted] = await tx
		.insert(smartCollections)
		.values({
			slug,
			title: input.title,
			collectionType: input.collectionType,
			ruleKey: input.ruleKey,
			taxonomy: input.taxonomy ?? null,
			brandGroup: input.brandGroup ?? null,
			status: "active",
		})
		.returning({ id: smartCollections.id });

	return inserted.id;
}

async function rebuildCollectionsForFamilies(
	tx: DatabaseType,
	familyIds: string[],
): Promise<number> {
	if (familyIds.length === 0) {
		return 0;
	}

	const families = await tx
		.select({
			id: productFamilies.id,
			displayName: productFamilies.displayName,
			familyGroupKey: productFamilies.familyGroupKey,
			taxonomy: productFamilies.taxonomy,
			brandGroup: productFamilies.brandGroup,
		})
		.from(productFamilies)
		.where(inArray(productFamilies.id, familyIds));

	await tx
		.delete(smartCollectionMembers)
		.where(inArray(smartCollectionMembers.familyId, familyIds));

	const touchedCollectionIds = new Set<string>();

	for (const family of families) {
		if (family.taxonomy) {
			const collectionId = await ensureCollection(tx, {
				ruleKey: `taxonomy:${normalizeProductName(family.taxonomy)}`,
				title: toTitleCase(family.taxonomy),
				collectionType: "taxonomy",
				taxonomy: family.taxonomy,
			});
			touchedCollectionIds.add(collectionId);
			await tx
				.insert(smartCollectionMembers)
				.values({
					collectionId,
					familyId: family.id,
					rank: 100,
					score: 1,
					source: "graph_sync",
				})
				.onConflictDoNothing();
		}

		if (family.brandGroup) {
			const collectionId = await ensureCollection(tx, {
				ruleKey: `brand:${normalizeProductName(family.brandGroup)}`,
				title: `${family.brandGroup} izbor`,
				collectionType: "brand",
				brandGroup: family.brandGroup,
				taxonomy: family.taxonomy,
			});
			touchedCollectionIds.add(collectionId);
			await tx
				.insert(smartCollectionMembers)
				.values({
					collectionId,
					familyId: family.id,
					rank: 90,
					score: 0.9,
					source: "graph_sync",
				})
				.onConflictDoNothing();
		}

		const baseTitle = family.displayName
			.replace(/\b(Bio|Zero|Max|Ultra|Platinum|Sensitive|All in One|Original)\b/giu, "")
			.trim();
		const collectionId = await ensureCollection(tx, {
			ruleKey: `family-group:${family.familyGroupKey}`,
			title: baseTitle.length > 0 ? baseTitle : family.displayName,
			collectionType: "family_group",
			taxonomy: family.taxonomy,
			brandGroup: family.brandGroup,
		});
		touchedCollectionIds.add(collectionId);
		await tx
			.insert(smartCollectionMembers)
			.values({
				collectionId,
				familyId: family.id,
				rank: 80,
				score: 0.8,
				source: "graph_sync",
			})
			.onConflictDoNothing();
	}

	return touchedCollectionIds.size;
}

async function cleanupOrphans(tx: DatabaseType): Promise<void> {
	await tx.execute(sql`
		DELETE FROM product_variants pv
		WHERE NOT EXISTS (
			SELECT 1 FROM offer_variant_links ovl
			WHERE ovl.variant_id = pv.id
		)
	`);

	await tx.execute(sql`
		DELETE FROM product_families pf
		WHERE NOT EXISTS (
			SELECT 1 FROM product_variants pv
			WHERE pv.family_id = pf.id
		)
	`);
}

async function loadCatalogRows(itemIds: string[]): Promise<CatalogSourceRow[]> {
	const db = getDatabase();
	return await db
		.select({
			id: retailerItems.id,
			name: retailerItems.name,
			brand: retailerItems.brand,
			category: retailerItems.category,
			subcategory: retailerItems.subcategory,
			imageUrl: retailerItems.imageUrl,
			normalizedUnit: retailerItems.normalizedUnit,
			normalizedQuantity: retailerItems.normalizedQuantity,
			featureEverydayName: retailerItemFeatures.everydayName,
			featureProductType: retailerItemFeatures.productType,
			featureVariant: retailerItemFeatures.variant,
			featureBrand: retailerItemFeatures.extractedBrand,
			featureExtractedUnit: retailerItemFeatures.extractedUnit,
			featureTotalAmount: retailerItemFeatures.totalAmount,
			featurePackAmount: retailerItemFeatures.packAmount,
			featureContainerType: retailerItemFeatures.containerType,
		})
		.from(retailerItems)
		.leftJoin(
			retailerItemFeatures,
			eq(retailerItemFeatures.retailerItemId, retailerItems.id),
		)
		.where(
			and(
				inArray(retailerItems.id, itemIds),
				isNull(retailerItems.mergedIntoId),
			),
		);
}

export async function syncCatalogGraphForItems(
	itemIds: string[],
): Promise<SyncGraphResult> {
	if (itemIds.length === 0) {
		return {
			familiesTouched: 0,
			variantsTouched: 0,
			offersLinked: 0,
			collectionsTouched: 0,
			relationsTouched: 0,
		};
	}

	const sourceRows = await loadCatalogRows(itemIds);
	const db = getDatabase();

	if (sourceRows.length === 0) {
		return {
			familiesTouched: 0,
			variantsTouched: 0,
			offersLinked: 0,
			collectionsTouched: 0,
			relationsTouched: 0,
		};
	}

	return await db.transaction(async (tx) => {
		const previousFamilies = await tx
			.select({
				id: productFamilies.id,
				familyGroupKey: productFamilies.familyGroupKey,
			})
			.from(offerVariantLinks)
			.innerJoin(productVariants, eq(productVariants.id, offerVariantLinks.variantId))
			.innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
			.where(inArray(offerVariantLinks.retailerItemId, itemIds));

		await tx
			.delete(offerVariantLinks)
			.where(inArray(offerVariantLinks.retailerItemId, itemIds));

		const touchedFamilyIds = new Set(previousFamilies.map((family) => family.id));
		const touchedFamilyGroupKeys = new Set(
			previousFamilies.map((family) => family.familyGroupKey),
		);
		let variantsTouched = 0;
		let offersLinked = 0;

		for (const row of sourceRows) {
			const family = deriveFamilyIdentity(row);
			const familyId = await upsertFamily(tx, family);
			touchedFamilyIds.add(familyId);
			touchedFamilyGroupKeys.add(family.familyGroupKey);

			const variant = deriveVariantIdentity(row, family);
			const variantId = await upsertVariant(tx, familyId, variant);
			variantsTouched += 1;

			await tx.insert(offerVariantLinks).values({
				variantId,
				retailerItemId: row.id,
				source: "graph_sync",
				confidence: 0.9,
			});
			offersLinked += 1;
		}

		await cleanupOrphans(tx);
		const relationsTouched = await rebuildFamilyGroupRelations(
			tx,
			Array.from(touchedFamilyGroupKeys),
		);
		const collectionsTouched = await rebuildCollectionsForFamilies(
			tx,
			Array.from(touchedFamilyIds),
		);

		log.info("Catalog graph synced", {
			itemCount: itemIds.length,
			familiesTouched: touchedFamilyIds.size,
			variantsTouched,
			offersLinked,
			collectionsTouched,
			relationsTouched,
		});

		return {
			familiesTouched: touchedFamilyIds.size,
			variantsTouched,
			offersLinked,
			collectionsTouched,
			relationsTouched,
		};
	});
}
