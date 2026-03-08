import { eq, isNull, sql } from "drizzle-orm";
import {
	closeDatabase,
	getDatabase,
	productFamilies,
	productVariants,
	retailerItemFeatures,
	retailerItems,
	smartCollections,
} from "@/db";
import {
	deriveFamilyIdentity,
	deriveVariantIdentity,
	type CatalogIdentitySourceRow,
	slugify,
	stripQualityMarkers,
	toTitleCase,
} from "@/lib/catalog/graph-identity";
import { normalizeProductName } from "@/lib/matching/normalize";
import { chunk } from "@/lib/collections/chunk";
import { generatePrefixedId } from "@/utils/id";

type FamilyStageRow = {
	id: string;
	familyKey: string;
	slug: string;
	displayName: string;
	titleNormalized: string;
	familyGroupKey: string;
	taxonomy: string | null;
	familyKind: string;
	brandGroup: string | null;
	coreName: string | null;
	qualityLabel: string | null;
	imageUrl: string | null;
	status: "active";
};

type VariantStageRow = {
	id: string;
	familyId: string;
	variantKey: string;
	displayName: string;
	packLabel: string | null;
	normalizedUnit: string | null;
	normalizedQuantity: number | null;
	packCount: number;
	containerType: string | null;
	imageUrl: string | null;
};

type OfferVariantLinkStageRow = {
	id: string;
	variantId: string;
	retailerItemId: string;
	source: "graph_sync";
	confidence: number;
};

type FamilyRelationStageRow = {
	id: string;
	sourceFamilyId: string;
	targetFamilyId: string;
	relationType: "quality_tier" | "formula_sibling";
	score: number;
	source: "graph_sync";
};

type SmartCollectionStageRow = {
	id: string;
	slug: string;
	title: string;
	collectionType: "taxonomy" | "brand" | "family_group";
	ruleKey: string;
	taxonomy: string | null;
	brandGroup: string | null;
	status: "active";
};

type SmartCollectionMemberStageRow = {
	id: string;
	collectionId: string;
	familyId: string;
	rank: number;
	score: number;
	source: "graph_sync";
};

type ExistingFamilyRow = {
	id: string;
	familyKey: string;
	slug: string;
};

type ExistingVariantRow = {
	id: string;
	familyKey: string;
	variantKey: string;
};

type ExistingCollectionRow = {
	id: string;
	ruleKey: string;
	slug: string;
};

type ExistingCatalogState = {
	familyByKey: Map<string, ExistingFamilyRow>;
	variantByKey: Map<string, ExistingVariantRow>;
	collectionByRuleKey: Map<string, ExistingCollectionRow>;
};

function makeUniqueSlug(
	base: string,
	ownerKey: string,
	existingSlug: string | null,
	owners: Map<string, string>,
): string {
	const preferred = existingSlug ?? base;
	if (!preferred) {
		throw new Error(`Missing slug for ${ownerKey}`);
	}
	if (!owners.has(preferred) || owners.get(preferred) === ownerKey) {
		owners.set(preferred, ownerKey);
		return preferred;
	}

	const suffixBase = preferred.slice(0, 88);
	let counter = 2;
	while (true) {
		const candidate = `${suffixBase}-${counter}`;
		if (!owners.has(candidate) || owners.get(candidate) === ownerKey) {
			owners.set(candidate, ownerKey);
			return candidate;
		}
		counter += 1;
	}
}

function mergeFamilyRow(
	existing: FamilyStageRow,
	next: ReturnType<typeof deriveFamilyIdentity>,
): FamilyStageRow {
	return {
		...existing,
		displayName:
			existing.displayName.length >= next.displayName.length
				? existing.displayName
				: next.displayName,
		titleNormalized:
			existing.titleNormalized.length >= normalizeProductName(next.displayName).length
				? existing.titleNormalized
				: normalizeProductName(next.displayName),
		coreName: existing.coreName ?? next.coreName,
		imageUrl: existing.imageUrl ?? next.imageUrl,
		taxonomy: existing.taxonomy ?? next.taxonomy,
		brandGroup: existing.brandGroup ?? next.brandGroup,
		qualityLabel: existing.qualityLabel ?? next.qualityLabel,
	};
}

function mergeVariantRow(
	existing: VariantStageRow,
	next: ReturnType<typeof deriveVariantIdentity>,
): VariantStageRow {
	return {
		...existing,
		displayName:
			existing.displayName.length >= next.displayName.length
				? existing.displayName
				: next.displayName,
		packLabel: existing.packLabel ?? next.packLabel,
		imageUrl: existing.imageUrl ?? next.imageUrl,
		normalizedUnit: existing.normalizedUnit ?? next.normalizedUnit,
		normalizedQuantity:
			existing.normalizedQuantity ?? next.normalizedQuantity,
		containerType: existing.containerType ?? next.containerType,
	};
}

async function loadSourceRows(): Promise<CatalogIdentitySourceRow[]> {
	const db = getDatabase();
	return db
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
		.where(isNull(retailerItems.mergedIntoId));
}

async function loadExistingState(): Promise<ExistingCatalogState> {
	const db = getDatabase();
	const [families, variants, collections] = await Promise.all([
		db
			.select({
				id: productFamilies.id,
				familyKey: productFamilies.familyKey,
				slug: productFamilies.slug,
			})
			.from(productFamilies),
		db
			.select({
				id: productVariants.id,
				familyKey: productFamilies.familyKey,
				variantKey: productVariants.variantKey,
			})
			.from(productVariants)
			.innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId)),
		db
			.select({
				id: smartCollections.id,
				ruleKey: smartCollections.ruleKey,
				slug: smartCollections.slug,
			})
			.from(smartCollections),
	]);

	return {
		familyByKey: new Map(families.map((row) => [row.familyKey, row])),
		variantByKey: new Map(
			variants.map((row) => [`${row.familyKey}::${row.variantKey}`, row]),
		),
		collectionByRuleKey: new Map(collections.map((row) => [row.ruleKey, row])),
	};
}

function buildGraph(
	sourceRows: CatalogIdentitySourceRow[],
	existing: ExistingCatalogState,
): {
	families: FamilyStageRow[];
	variants: VariantStageRow[];
	links: OfferVariantLinkStageRow[];
	relations: FamilyRelationStageRow[];
	collections: SmartCollectionStageRow[];
	members: SmartCollectionMemberStageRow[];
} {
	const familyByKey = new Map<string, FamilyStageRow>();
	const variantByCompositeKey = new Map<string, VariantStageRow>();
	const familySlugOwners = new Map<string, string>();
	const linkRows: OfferVariantLinkStageRow[] = [];

	let processed = 0;
	for (const row of sourceRows) {
		const familyIdentity = deriveFamilyIdentity(row);
		let familyRow = familyByKey.get(familyIdentity.familyKey);
		if (!familyRow) {
			const existingFamily = existing.familyByKey.get(familyIdentity.familyKey);
			familyRow = {
				id: existingFamily?.id ?? generatePrefixedId("pfm"),
				familyKey: familyIdentity.familyKey,
				slug: makeUniqueSlug(
					slugify(familyIdentity.displayName),
					familyIdentity.familyKey,
					existingFamily?.slug ?? null,
					familySlugOwners,
				),
				displayName: familyIdentity.displayName,
				titleNormalized: normalizeProductName(familyIdentity.displayName),
				familyGroupKey: familyIdentity.familyGroupKey,
				taxonomy: familyIdentity.taxonomy,
				familyKind: familyIdentity.familyKind,
				brandGroup: familyIdentity.brandGroup,
				coreName: familyIdentity.coreName,
				qualityLabel: familyIdentity.qualityLabel,
				imageUrl: familyIdentity.imageUrl,
				status: "active",
			};
		} else {
			familyRow = mergeFamilyRow(familyRow, familyIdentity);
		}
		familyByKey.set(familyIdentity.familyKey, familyRow);

		const variantIdentity = deriveVariantIdentity(row, familyIdentity);
		const variantCompositeKey = `${familyIdentity.familyKey}::${variantIdentity.variantKey}`;
		let variantRow = variantByCompositeKey.get(variantCompositeKey);
		if (!variantRow) {
			const existingVariant = existing.variantByKey.get(variantCompositeKey);
			variantRow = {
				id: existingVariant?.id ?? generatePrefixedId("pvt"),
				familyId: familyRow.id,
				variantKey: variantIdentity.variantKey,
				displayName: variantIdentity.displayName,
				packLabel: variantIdentity.packLabel,
				normalizedUnit: variantIdentity.normalizedUnit,
				normalizedQuantity: variantIdentity.normalizedQuantity,
				packCount: variantIdentity.packCount,
				containerType: variantIdentity.containerType,
				imageUrl: variantIdentity.imageUrl,
			};
		} else {
			variantRow = mergeVariantRow(variantRow, variantIdentity);
		}
		variantByCompositeKey.set(variantCompositeKey, variantRow);

		linkRows.push({
			id: generatePrefixedId("ovl"),
			variantId: variantRow.id,
			retailerItemId: row.id,
			source: "graph_sync",
			confidence: 0.9,
		});

		processed += 1;
		if (processed % 10000 === 0 || processed === sourceRows.length) {
			console.log(
				`aggregated ${processed}/${sourceRows.length} source offers into ${familyByKey.size} families and ${variantByCompositeKey.size} variants`,
			);
		}
	}

	const familyRows = Array.from(familyByKey.values());
	const variantRows = Array.from(variantByCompositeKey.values());
	const familyGroups = new Map<string, FamilyStageRow[]>();
	for (const family of familyRows) {
		const group = familyGroups.get(family.familyGroupKey) ?? [];
		group.push(family);
		familyGroups.set(family.familyGroupKey, group);
	}

	const relationRows: FamilyRelationStageRow[] = [];
	for (const group of familyGroups.values()) {
		for (let i = 0; i < group.length; i += 1) {
			for (let j = 0; j < group.length; j += 1) {
				if (i === j) {
					continue;
				}
				relationRows.push({
					id: generatePrefixedId("frl"),
					sourceFamilyId: group[i]!.id,
					targetFamilyId: group[j]!.id,
					relationType:
						group[i]!.qualityLabel !== group[j]!.qualityLabel
							? "quality_tier"
							: "formula_sibling",
					score: 0.9,
					source: "graph_sync",
				});
			}
		}
	}

	const collectionById = new Map<string, SmartCollectionStageRow>();
	const collectionRuleMap = new Map<string, SmartCollectionStageRow>();
	const collectionSlugOwners = new Map<string, string>();
	const memberMap = new Map<string, SmartCollectionMemberStageRow>();

	const materializeCollection = (
		row: ExistingCollectionRow | SmartCollectionStageRow,
		input: {
			ruleKey: string;
			title: string;
			collectionType: "taxonomy" | "brand" | "family_group";
			taxonomy?: string | null;
			brandGroup?: string | null;
		},
	): SmartCollectionStageRow => {
		if ("title" in row) {
			row.title = input.title;
			row.collectionType = input.collectionType;
			row.taxonomy = input.taxonomy ?? null;
			row.brandGroup = input.brandGroup ?? null;
			return row;
		}
		return {
			id: row.id,
			slug: row.slug,
			title: input.title,
			collectionType: input.collectionType,
			ruleKey: row.ruleKey,
			taxonomy: input.taxonomy ?? null,
			brandGroup: input.brandGroup ?? null,
			status: "active",
		};
	};

	const getOrCreateCollection = (input: {
		ruleKey: string;
		title: string;
		collectionType: "taxonomy" | "brand" | "family_group";
		taxonomy?: string | null;
		brandGroup?: string | null;
	}) => {
		const existingByRule = collectionRuleMap.get(input.ruleKey)
			?? existing.collectionByRuleKey.get(input.ruleKey);
		if (existingByRule) {
			const row = materializeCollection(existingByRule, input);
			row.slug = makeUniqueSlug(
				slugify(input.title) || "collection",
				input.ruleKey,
				row.slug,
				collectionSlugOwners,
			);
			collectionById.set(row.id, row);
			collectionRuleMap.set(input.ruleKey, row);
			return row;
		}

		const row: SmartCollectionStageRow = {
			id: generatePrefixedId("scl"),
			slug: makeUniqueSlug(
				slugify(input.title) || "collection",
				input.ruleKey,
				null,
				collectionSlugOwners,
			),
			title: input.title,
			collectionType: input.collectionType,
			ruleKey: input.ruleKey,
			taxonomy: input.taxonomy ?? null,
			brandGroup: input.brandGroup ?? null,
			status: "active",
		};
		collectionById.set(row.id, row);
		collectionRuleMap.set(input.ruleKey, row);
		return row;
	};

	const upsertMember = (
		collectionId: string,
		familyId: string,
		rank: number,
		score: number,
	) => {
		const key = `${collectionId}::${familyId}`;
		const existingMember = memberMap.get(key);
		if (existingMember) {
			if (score > existingMember.score) {
				existingMember.score = score;
				existingMember.rank = rank;
			}
			return;
		}
		memberMap.set(key, {
			id: generatePrefixedId("scm"),
			collectionId,
			familyId,
			rank,
			score,
			source: "graph_sync",
		});
	};

	for (const family of familyRows) {
		if (family.taxonomy) {
			const collection = getOrCreateCollection({
				ruleKey: `taxonomy:${normalizeProductName(family.taxonomy)}`,
				title: toTitleCase(family.taxonomy),
				collectionType: "taxonomy",
				taxonomy: family.taxonomy,
			});
			upsertMember(collection.id, family.id, 100, 1);
		}

		if (family.brandGroup) {
			const collection = getOrCreateCollection({
				ruleKey: `brand:${normalizeProductName(family.brandGroup)}`,
				title: `${family.brandGroup} izbor`,
				collectionType: "brand",
				taxonomy: family.taxonomy,
				brandGroup: family.brandGroup,
			});
			upsertMember(collection.id, family.id, 90, 0.9);
		}

		const baseTitle = stripQualityMarkers(family.displayName);
		const collection = getOrCreateCollection({
			ruleKey: `family-group:${family.familyGroupKey}`,
			title: baseTitle.length > 0 ? baseTitle : family.displayName,
			collectionType: "family_group",
			taxonomy: family.taxonomy,
			brandGroup: family.brandGroup,
		});
		upsertMember(collection.id, family.id, 80, 0.8);
	}

	return {
		families: familyRows,
		variants: variantRows,
		links: linkRows,
		relations: relationRows,
		collections: Array.from(collectionById.values()),
		members: Array.from(memberMap.values()),
	};
}

async function stageRows(
	label: string,
	rows: unknown[],
	batchSize: number,
	insertChunk: (batch: unknown[]) => Promise<void>,
) {
	let written = 0;
	for (const batch of chunk(rows, batchSize)) {
		await insertChunk(batch);
		written += batch.length;
		if (written % (batchSize * 5) === 0 || written === rows.length) {
			console.log(`staged ${label}: ${written}/${rows.length}`);
		}
	}
}

async function main() {
	const db = getDatabase();
	console.log("Loading source offers...");
	const [sourceRows, existing] = await Promise.all([
		loadSourceRows(),
		loadExistingState(),
	]);
	console.log(`Loaded ${sourceRows.length} source offers`);

	const graph = buildGraph(sourceRows, existing);
	console.log(
		`Built graph in memory: ${graph.families.length} families, ${graph.variants.length} variants, ${graph.links.length} links, ${graph.collections.length} collections`,
	);

	await db.transaction(async (tx) => {
		await tx.execute(sql`SET LOCAL synchronous_commit = OFF`);

		await tx.execute(sql`
			CREATE TEMP TABLE tmp_product_families (
				id text NOT NULL,
				family_key text NOT NULL,
				slug text NOT NULL,
				display_name text NOT NULL,
				title_normalized text NOT NULL,
				family_group_key text NOT NULL,
				taxonomy text,
				family_kind text NOT NULL,
				brand_group text,
				core_name text,
				quality_label text,
				image_url text,
				status text NOT NULL
			) ON COMMIT DROP
		`);
		await tx.execute(sql`
			CREATE TEMP TABLE tmp_product_variants (
				id text NOT NULL,
				family_id text NOT NULL,
				variant_key text NOT NULL,
				display_name text NOT NULL,
				pack_label text,
				normalized_unit text,
				normalized_quantity real,
				pack_count integer NOT NULL,
				container_type text,
				image_url text
			) ON COMMIT DROP
		`);
		await tx.execute(sql`
			CREATE TEMP TABLE tmp_offer_variant_links (
				id text NOT NULL,
				variant_id text NOT NULL,
				retailer_item_id text NOT NULL,
				source text NOT NULL,
				confidence real
			) ON COMMIT DROP
		`);
		await tx.execute(sql`
			CREATE TEMP TABLE tmp_family_relations (
				id text NOT NULL,
				source_family_id text NOT NULL,
				target_family_id text NOT NULL,
				relation_type text NOT NULL,
				score real,
				source text NOT NULL
			) ON COMMIT DROP
		`);
		await tx.execute(sql`
			CREATE TEMP TABLE tmp_smart_collections (
				id text NOT NULL,
				slug text NOT NULL,
				title text NOT NULL,
				collection_type text NOT NULL,
				rule_key text NOT NULL,
				taxonomy text,
				brand_group text,
				status text NOT NULL
			) ON COMMIT DROP
		`);
		await tx.execute(sql`
			CREATE TEMP TABLE tmp_smart_collection_members (
				id text NOT NULL,
				collection_id text NOT NULL,
				family_id text NOT NULL,
				rank integer NOT NULL,
				score real,
				source text NOT NULL
			) ON COMMIT DROP
		`);

		await stageRows("families", graph.families, 1000, async (batch) => {
			const rows = batch as FamilyStageRow[];
			const values = sql.join(
				rows.map(
					(row) =>
						sql`(${row.id}, ${row.familyKey}, ${row.slug}, ${row.displayName}, ${row.titleNormalized}, ${row.familyGroupKey}, ${row.taxonomy}, ${row.familyKind}, ${row.brandGroup}, ${row.coreName}, ${row.qualityLabel}, ${row.imageUrl}, ${row.status})`,
				),
				sql`, `,
			);
			await tx.execute(sql`
				INSERT INTO tmp_product_families (
					id, family_key, slug, display_name, title_normalized, family_group_key,
					taxonomy, family_kind, brand_group, core_name, quality_label, image_url, status
				)
				VALUES ${values}
			`);
		});

		await stageRows("variants", graph.variants, 1000, async (batch) => {
			const rows = batch as VariantStageRow[];
			const values = sql.join(
				rows.map(
					(row) =>
						sql`(${row.id}, ${row.familyId}, ${row.variantKey}, ${row.displayName}, ${row.packLabel}, ${row.normalizedUnit}, ${row.normalizedQuantity}, ${row.packCount}, ${row.containerType}, ${row.imageUrl})`,
				),
				sql`, `,
			);
			await tx.execute(sql`
				INSERT INTO tmp_product_variants (
					id, family_id, variant_key, display_name, pack_label,
					normalized_unit, normalized_quantity, pack_count, container_type, image_url
				)
				VALUES ${values}
			`);
		});

		await stageRows("links", graph.links, 2000, async (batch) => {
			const rows = batch as OfferVariantLinkStageRow[];
			const values = sql.join(
				rows.map(
					(row) =>
						sql`(${row.id}, ${row.variantId}, ${row.retailerItemId}, ${row.source}, ${row.confidence})`,
				),
				sql`, `,
			);
			await tx.execute(sql`
				INSERT INTO tmp_offer_variant_links (
					id, variant_id, retailer_item_id, source, confidence
				)
				VALUES ${values}
			`);
		});

		await stageRows("relations", graph.relations, 2000, async (batch) => {
			const rows = batch as FamilyRelationStageRow[];
			const values = sql.join(
				rows.map(
					(row) =>
						sql`(${row.id}, ${row.sourceFamilyId}, ${row.targetFamilyId}, ${row.relationType}, ${row.score}, ${row.source})`,
				),
				sql`, `,
			);
			await tx.execute(sql`
				INSERT INTO tmp_family_relations (
					id, source_family_id, target_family_id, relation_type, score, source
				)
				VALUES ${values}
			`);
		});

		await stageRows("collections", graph.collections, 1000, async (batch) => {
			const rows = batch as SmartCollectionStageRow[];
			const values = sql.join(
				rows.map(
					(row) =>
						sql`(${row.id}, ${row.slug}, ${row.title}, ${row.collectionType}, ${row.ruleKey}, ${row.taxonomy}, ${row.brandGroup}, ${row.status})`,
				),
				sql`, `,
			);
			await tx.execute(sql`
				INSERT INTO tmp_smart_collections (
					id, slug, title, collection_type, rule_key, taxonomy, brand_group, status
				)
				VALUES ${values}
			`);
		});

		await stageRows("collection members", graph.members, 2000, async (batch) => {
			const rows = batch as SmartCollectionMemberStageRow[];
			const values = sql.join(
				rows.map(
					(row) =>
						sql`(${row.id}, ${row.collectionId}, ${row.familyId}, ${row.rank}, ${row.score}, ${row.source})`,
				),
				sql`, `,
			);
			await tx.execute(sql`
				INSERT INTO tmp_smart_collection_members (
					id, collection_id, family_id, rank, score, source
				)
				VALUES ${values}
			`);
		});

		console.log("Swapping staged graph into live tables...");
		await tx.execute(sql`
			TRUNCATE TABLE
				smart_collection_members,
				family_relations,
				offer_variant_links,
				product_variants,
				smart_collections,
				product_families
		`);

		await tx.execute(sql`
			INSERT INTO product_families (
				id, family_key, slug, display_name, title_normalized, family_group_key,
				taxonomy, family_kind, brand_group, core_name, quality_label, image_url, status
			)
			SELECT
				id, family_key, slug, display_name, title_normalized, family_group_key,
				taxonomy, family_kind, brand_group, core_name, quality_label, image_url, status
			FROM tmp_product_families
		`);

		await tx.execute(sql`
			INSERT INTO product_variants (
				id, family_id, variant_key, display_name, pack_label,
				normalized_unit, normalized_quantity, pack_count, container_type, image_url
			)
			SELECT
				id, family_id, variant_key, display_name, pack_label,
				normalized_unit, normalized_quantity, pack_count, container_type, image_url
			FROM tmp_product_variants
		`);

		await tx.execute(sql`
			INSERT INTO smart_collections (
				id, slug, title, collection_type, rule_key, taxonomy, brand_group, status
			)
			SELECT
				id, slug, title, collection_type, rule_key, taxonomy, brand_group, status
			FROM tmp_smart_collections
		`);

		await tx.execute(sql`
			INSERT INTO offer_variant_links (
				id, variant_id, retailer_item_id, source, confidence
			)
			SELECT
				id, variant_id, retailer_item_id, source, confidence
			FROM tmp_offer_variant_links
		`);

		await tx.execute(sql`
			INSERT INTO family_relations (
				id, source_family_id, target_family_id, relation_type, score, source
			)
			SELECT
				id, source_family_id, target_family_id, relation_type, score, source
			FROM tmp_family_relations
		`);

		await tx.execute(sql`
			INSERT INTO smart_collection_members (
				id, collection_id, family_id, rank, score, source
			)
			SELECT
				id, collection_id, family_id, rank, score, source
			FROM tmp_smart_collection_members
		`);
	});

	console.log("Catalog graph rebuild complete.");
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => {
		closeDatabase();
	});
