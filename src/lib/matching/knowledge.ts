import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";
import { extractProductAttributes } from "@/lib/knowledge/extractor";
import { loadCatalog } from "@/lib/knowledge/loader";
import type { KnowledgeCatalog, ProductDefinition } from "@/lib/knowledge/types";
import {
	productAliases,
	productLinks,
	products,
	productRelations,
	type DatabaseType,
} from "@/db";
import { normalizeKnowledgeText } from "@/lib/knowledge/utils";

const log = createLogger("matching");

type DbTransaction = Parameters<DatabaseType["transaction"]>[0] extends (
	transaction: infer Transaction,
) => Promise<unknown>
	? Transaction
	: never;

interface RetailerItemForKnowledge {
	id: string;
	name: string;
	brand: string | null;
	category: string | null;
	chain_slug: string | null;
	unit: string | null;
	unit_quantity: string | null;
	normalized_unit: string | null;
	normalized_quantity: number | null;
	image_url: string | null;
}

interface ChainEquivalenceMatch {
	canonicalKey: string;
	namePattern: string;
}

export interface KnowledgeMatchingResult {
	runId: string;
	processed: number;
	matchedByCanonicalKey: number;
	matchedByEquivalence: number;
	newLinks: number;
	createdProducts: number;
	aliasesAdded: number;
	noMatch: number;
}

export async function runKnowledgeMatching(options?: {
	batchSize?: number;
	catalogDir?: string;
}): Promise<KnowledgeMatchingResult> {
	const db = getDb();
	const runId = generatePrefixedId("run");
	const batchSize = options?.batchSize ?? 200;
	const catalog = await loadCatalog(options?.catalogDir);
	const result: KnowledgeMatchingResult = {
		runId,
		processed: 0,
		matchedByCanonicalKey: 0,
		matchedByEquivalence: 0,
		newLinks: 0,
		createdProducts: 0,
		aliasesAdded: 0,
		noMatch: 0,
	};

	const chainEquivalences = buildChainEquivalenceIndex(catalog);
	const productCache = new Map<string, string>();

	const rowsResult = await db.execute(sql`
		SELECT
			ri.id,
			ri.name,
			ri.brand,
			ri.category,
			ri.chain_slug,
			ri.unit,
			ri.unit_quantity,
			ri.normalized_unit,
			ri.normalized_quantity,
			ri.image_url
		FROM retailer_items ri
		WHERE ri.merged_into_id IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
		)
		AND NOT EXISTS (
			SELECT 1 FROM product_match_queue pmq
			WHERE pmq.retailer_item_id = ri.id
			AND pmq.status = 'pending'
		)
		ORDER BY ri.id
		LIMIT ${batchSize}
	`);

	const rows = (
		Array.isArray(rowsResult)
			? rowsResult
			: ((rowsResult as { rows?: unknown[] }).rows ?? [])
	) as RetailerItemForKnowledge[];

	for (const item of rows) {
		result.processed += 1;
		let linked = false;

		try {
			await db.transaction(async (tx) => {
				const extracted = extractProductAttributes(
					item.name,
					item.brand,
					item.category,
					catalog,
				);

				if (extracted.canonicalKey) {
					const product = await ensureProductByCanonicalKey(
						tx,
						extracted.canonicalKey,
						catalog,
						productCache,
						item,
					);
					if (product.created) {
						result.createdProducts += 1;
					}

					if (product.productId) {
						const inserted = await insertLink(tx, product.productId, item.id);
						if (inserted) {
							result.matchedByCanonicalKey += 1;
							result.newLinks += 1;
							linked = true;
						}
					}
				}

				if (linked) {
					return;
				}

				const chainSlug = item.chain_slug ?? "";
				const matches = chainEquivalences.get(chainSlug) ?? [];
				for (const match of matches) {
					if (!matchesEquivalencePattern(item.name, match.namePattern)) {
						continue;
					}

					const product = await ensureProductByCanonicalKey(
						tx,
						match.canonicalKey,
						catalog,
						productCache,
						item,
					);
					if (product.created) {
						result.createdProducts += 1;
					}
					if (!product.productId) {
						continue;
					}

					const inserted = await insertLink(tx, product.productId, item.id);
					if (!inserted) {
						break;
					}

					result.matchedByEquivalence += 1;
					result.newLinks += 1;
					linked = true;

					const aliasInserted = await insertAliasIfMissing(
						tx,
						product.productId,
						match.namePattern,
						`knowledge-equivalence:${chainSlug}`,
					);
					if (aliasInserted) {
						result.aliasesAdded += 1;
					}
					break;
				}
			});
		} catch (error) {
			log.error("knowledge matching failed for item", {
				itemId: item.id,
				error,
			});
		}

		if (!linked) {
			result.noMatch += 1;
		}
	}

	log.info("Knowledge matching completed", {
		runId,
		processed: result.processed,
		matchedByCanonicalKey: result.matchedByCanonicalKey,
		matchedByEquivalence: result.matchedByEquivalence,
		newLinks: result.newLinks,
		createdProducts: result.createdProducts,
		aliasesAdded: result.aliasesAdded,
		noMatch: result.noMatch,
	});

	return result;
}

export function matchesEquivalencePattern(name: string, pattern: string): boolean {
	const normalizedName = normalizeKnowledgeText(name);
	const normalizedPattern = normalizeKnowledgeText(pattern);
	if (!normalizedPattern) {
		return false;
	}

	return normalizedName.includes(normalizedPattern);
}

export function getProductTypeFromCanonicalKey(
	canonicalKey: string | null | undefined,
): string | null {
	if (!canonicalKey) {
		return null;
	}
	const firstDash = canonicalKey.indexOf("-");
	if (firstDash <= 0) {
		return canonicalKey;
	}
	return canonicalKey.slice(0, firstDash);
}

function buildChainEquivalenceIndex(
	catalog: KnowledgeCatalog,
): Map<string, ChainEquivalenceMatch[]> {
	const byChain = new Map<string, ChainEquivalenceMatch[]>();

	for (const equivalence of catalog.equivalencesVerified) {
		for (const item of equivalence.items) {
			const bucket = byChain.get(item.chain) ?? [];
			bucket.push({
				canonicalKey: equivalence.canonicalKey,
				namePattern: item.name_pattern,
			});
			byChain.set(item.chain, bucket);
		}
	}

	return byChain;
}

async function ensureProductByCanonicalKey(
	tx: DbTransaction,
	canonicalKey: string,
	catalog: KnowledgeCatalog,
	cache: Map<string, string>,
	item: RetailerItemForKnowledge,
): Promise<{ productId: string | null; created: boolean }> {
	const cached = cache.get(canonicalKey);
	if (cached) {
		return { productId: cached, created: false };
	}

	// Advisory lock prevents concurrent transactions from racing on the same canonical key
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext(${canonicalKey}))`,
	);

	const existing = await tx
		.select({ id: products.id })
		.from(products)
		.where(eq(products.canonicalKey, canonicalKey))
		.limit(1);
	if (existing[0]?.id) {
		cache.set(canonicalKey, existing[0].id);
		return { productId: existing[0].id, created: false };
	}

	const definition = catalog.productsByCanonicalKey.get(canonicalKey);
	if (!definition) {
		return { productId: null, created: false };
	}

	const insertPayload = buildProductInsertPayload(definition, canonicalKey, item);
	const inserted = await tx.insert(products).values(insertPayload).returning({
		id: products.id,
	});
	const insertedId = inserted[0]?.id ?? null;
	if (insertedId) {
		cache.set(canonicalKey, insertedId);
		return { productId: insertedId, created: true };
	}

	return { productId: null, created: false };
}

function buildProductInsertPayload(
	definition: ProductDefinition,
	canonicalKey: string,
	item: RetailerItemForKnowledge,
) {
	const attributes = definition.attributes;
	const volumeValue = getNumericAttribute(attributes, "volume_value");
	const volumeUnit = getStringAttribute(attributes, "volume_unit");
	const normalized = normalizeQuantityAndUnit(volumeUnit, volumeValue);

	const fallbackBrand = item.brand?.trim() || null;
	const fallbackUnit = item.unit?.trim() || null;
	const fallbackUnitQuantity = item.unit_quantity?.trim() || null;

	return {
		name: definition.display_name,
		description: null,
		category: definition.category,
		subcategory: null,
		brand: definition.known_brands[0] ?? fallbackBrand,
		unit: normalized.normalizedUnit ?? fallbackUnit,
		unitQuantity:
			normalized.displayQuantity ??
			(volumeValue != null ? String(volumeValue) : fallbackUnitQuantity),
		imageUrl: item.image_url,
		normalizedUnit: normalized.normalizedUnit,
		normalizedQuantity:
			normalized.normalizedQuantity ?? item.normalized_quantity ?? null,
		canonicalKey,
	};
}

function normalizeQuantityAndUnit(unit: string | null, quantity: number | null) {
	if (!unit || quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
		return {
			normalizedUnit: null as string | null,
			normalizedQuantity: null as number | null,
			displayQuantity: null as string | null,
		};
	}

	const normalized = unit.toLowerCase();
	if (normalized === "g" || normalized === "gr") {
		return {
			normalizedUnit: "kg",
			normalizedQuantity: quantity / 1000,
			displayQuantity: String(quantity),
		};
	}
	if (normalized === "ml") {
		return {
			normalizedUnit: "l",
			normalizedQuantity: quantity / 1000,
			displayQuantity: String(quantity),
		};
	}
	if (["lt", "lit", "ltr"].includes(normalized)) {
		return {
			normalizedUnit: "l",
			normalizedQuantity: quantity,
			displayQuantity: String(quantity),
		};
	}
	if (["pcs", "komad", "ko", "pz"].includes(normalized)) {
		return {
			normalizedUnit: "kom",
			normalizedQuantity: quantity,
			displayQuantity: String(quantity),
		};
	}

	return {
		normalizedUnit: normalized,
		normalizedQuantity: quantity,
		displayQuantity: String(quantity),
	};
}

function getNumericAttribute(
	attributes: Record<string, unknown>,
	name: string,
): number | null {
	const raw = attributes[name];
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw;
	}
	if (typeof raw === "string") {
		const parsed = Number.parseFloat(raw);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function getStringAttribute(
	attributes: Record<string, unknown>,
	name: string,
): string | null {
	const raw = attributes[name];
	if (typeof raw === "string" && raw.trim().length > 0) {
		return raw.trim();
	}
	return null;
}

async function insertLink(
	tx: DbTransaction,
	productId: string,
	retailerItemId: string,
): Promise<boolean> {
	const inserted = await tx
		.insert(productLinks)
		.values({
			productId,
			retailerItemId,
			confidence: "knowledge",
		})
		.onConflictDoNothing({ target: [productLinks.retailerItemId] })
		.returning({ id: productLinks.id });
	return inserted.length > 0;
}

async function insertAliasIfMissing(
	tx: DbTransaction,
	productId: string,
	alias: string,
	source: string,
): Promise<boolean> {
	const existing = await tx
		.select({ id: productAliases.id })
		.from(productAliases)
		.where(
			and(
				eq(productAliases.productId, productId),
				eq(productAliases.alias, alias),
			),
		)
		.limit(1);
	if (existing.length > 0) {
		return false;
	}

	await tx.insert(productAliases).values({ productId, alias, source });
	return true;
}

export async function ensureVariantRelation(
	tx: DbTransaction,
	productId: string,
	relatedProductId: string,
): Promise<void> {
	if (productId === relatedProductId) {
		return;
	}

	const existing = await tx
		.select({ id: productRelations.id })
		.from(productRelations)
		.where(
			and(
				eq(productRelations.productId, productId),
				eq(productRelations.relatedProductId, relatedProductId),
				eq(productRelations.relationType, "variant"),
			),
		)
		.limit(1);
	if (existing.length > 0) {
		return;
	}

	await tx.insert(productRelations).values({
		productId,
		relatedProductId,
		relationType: "variant",
	});
}
