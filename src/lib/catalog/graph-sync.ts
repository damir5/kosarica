import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type DatabaseType, getDatabase } from "@/db";
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
	type CatalogIdentitySourceRow,
	type DerivedFamilyIdentity,
	type DerivedVariantIdentity,
	deriveFamilyIdentity,
	deriveVariantIdentity,
	slugify,
	stripQualityMarkers,
	toTitleCase,
} from "@/lib/catalog/graph-identity";
import { normalizeProductName } from "@/lib/matching/normalize";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

type CatalogSourceRow = CatalogIdentitySourceRow;

type SyncGraphResult = {
	familiesTouched: number;
	variantsTouched: number;
	offersLinked: number;
	collectionsTouched: number;
	relationsTouched: number;
};

async function upsertFamily(
	tx: DatabaseType,
	family: DerivedFamilyIdentity,
): Promise<string> {
	const [existing] = await tx
		.select({ id: productFamilies.id })
		.from(productFamilies)
		.where(eq(productFamilies.familyKey, family.familyKey))
		.limit(1);

	let slug = slugify(family.displayName) || "product";
	const slugBase = slug.slice(0, 88) || "product";
	for (let counter = 2; ; counter += 1) {
		const [collision] = await tx
			.select({ id: productFamilies.id })
			.from(productFamilies)
			.where(eq(productFamilies.slug, slug))
			.limit(1);
		if (!collision || collision.id === existing?.id) {
			break;
		}
		slug = `${slugBase}-${counter}`;
	}

	if (existing) {
		await tx
			.update(productFamilies)
			.set({
				slug,
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
			slug,
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
		await tx
			.delete(familyRelations)
			.where(
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
	const desiredSlug = slugify(input.title) || "collection";
	const [existing] = await tx
		.select({
			id: smartCollections.id,
			slug: smartCollections.slug,
		})
		.from(smartCollections)
		.where(eq(smartCollections.ruleKey, input.ruleKey))
		.limit(1);

	let slug = desiredSlug;
	const slugBase = desiredSlug.slice(0, 88) || "collection";
	for (let counter = 2; ; counter += 1) {
		const [collision] = await tx
			.select({ id: smartCollections.id })
			.from(smartCollections)
			.where(eq(smartCollections.slug, slug))
			.limit(1);
		if (!collision || collision.id === existing?.id) {
			break;
		}
		slug = `${slugBase}-${counter}`;
	}

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

		const baseTitle = stripQualityMarkers(family.displayName);
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
			.innerJoin(
				productVariants,
				eq(productVariants.id, offerVariantLinks.variantId),
			)
			.innerJoin(
				productFamilies,
				eq(productFamilies.id, productVariants.familyId),
			)
			.where(inArray(offerVariantLinks.retailerItemId, itemIds));

		await tx
			.delete(offerVariantLinks)
			.where(inArray(offerVariantLinks.retailerItemId, itemIds));

		const touchedFamilyIds = new Set(
			previousFamilies.map((family) => family.id),
		);
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
