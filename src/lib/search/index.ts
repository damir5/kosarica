import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
	canonicalSkus,
	chains,
	retailerItems,
	searchIndex,
	skuItemLinks,
	stores,
} from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";
import type { IndexedEntity, SearchEntityType } from "./types";

const log = createLogger("search");

export type { IndexedEntity, SearchEntityType } from "./types";

async function upsertSearchIndex(entity: IndexedEntity): Promise<void> {
	const db = getDb();

	await db
		.insert(searchIndex)
		.values({
			id: generatePrefixedId("six"),
			entityType: entity.entityType,
			entityId: entity.entityId,
			chainSlug: entity.chainSlug,
			category: entity.category,
			subcategory: entity.subcategory,
			title: entity.title,
			subtitle: entity.subtitle,
			body: entity.body,
			imageUrl: entity.imageUrl,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [searchIndex.entityType, searchIndex.entityId],
			set: {
				chainSlug: entity.chainSlug,
				category: entity.category,
				subcategory: entity.subcategory,
				title: entity.title,
				subtitle: entity.subtitle,
				body: entity.body,
				imageUrl: entity.imageUrl,
				updatedAt: new Date(),
			},
		});
}

export async function indexProduct(productId: string): Promise<void> {
	const db = getDb();

	const [sku] = await db
		.select({
			id: canonicalSkus.id,
			baseProductId: canonicalSkus.baseProductId,
			isBaseProduct: canonicalSkus.isBaseProduct,
		})
		.from(canonicalSkus)
		.where(eq(canonicalSkus.id, productId))
		.limit(1);

	if (!sku) {
		log.warn("Canonical SKU not found for indexing", { productId });
		return;
	}

	const targetProductId = sku.isBaseProduct ? sku.id : sku.baseProductId;
	if (!targetProductId) {
		log.warn("Variant SKU missing base product; skipping index", { productId });
		return;
	}

	const [product] = await db
		.select({
			id: canonicalSkus.id,
			canonicalName: canonicalSkus.canonicalName,
			productType: canonicalSkus.productType,
		})
		.from(canonicalSkus)
		.where(
			and(
				eq(canonicalSkus.id, targetProductId),
				eq(canonicalSkus.isBaseProduct, true),
				isNull(canonicalSkus.mergedIntoId),
			),
		)
		.limit(1);

	if (!product) {
		log.warn("Base canonical SKU not found for indexing", {
			productId,
			targetProductId,
		});
		return;
	}

	if (!product.canonicalName) {
		log.warn("Canonical SKU missing canonical name; skipping index", {
			productId,
		});
		return;
	}

	await upsertSearchIndex({
		entityType: "product",
		entityId: product.id,
		chainSlug: null,
		category: product.productType ?? "product",
		subcategory: null,
		title: product.canonicalName,
		subtitle: null,
		body: [product.canonicalName, product.productType].filter(Boolean).join(" ") || null,
		imageUrl: null,
	});
}

export async function indexRetailerItem(itemId: string): Promise<void> {
	const db = getDb();

	const [item] = await db
		.select()
		.from(retailerItems)
		.where(eq(retailerItems.id, itemId))
		.limit(1);

	if (!item) {
		log.warn("Retailer item not found for indexing", { itemId });
		return;
	}

	const [link] = await db
		.select({ retailerItemId: skuItemLinks.retailerItemId })
		.from(skuItemLinks)
		.where(eq(skuItemLinks.retailerItemId, item.id))
		.limit(1);

	if (item.mergedIntoId || link) {
		await removeFromSearchIndex("item", item.id);
		return;
	}

	await upsertSearchIndex({
		entityType: "item",
		entityId: item.id,
		chainSlug: item.chainSlug ?? null,
		category: item.category ?? null,
		subcategory: item.subcategory ?? null,
		title: item.name,
		subtitle: item.brand ?? null,
		body:
			[item.description, item.category, item.subcategory, item.brand]
				.filter(Boolean)
				.join(" ") || null,
		imageUrl: item.imageUrl ?? null,
	});
}

export async function indexStore(storeId: string): Promise<void> {
	const db = getDb();

	const result = await db
		.select({
			store: stores,
			chainName: chains.name,
		})
		.from(stores)
		.innerJoin(chains, eq(chains.slug, stores.chainSlug))
		.where(eq(stores.id, storeId))
		.limit(1);

	const row = result[0];
	if (!row) {
		log.warn("Store not found for indexing", { storeId });
		return;
	}

	const store = row.store;
	await upsertSearchIndex({
		entityType: "store",
		entityId: store.id,
		chainSlug: store.chainSlug ?? null,
		category: null,
		subcategory: null,
		title: store.name,
		subtitle: row.chainName,
		body:
			[store.address, store.city, store.postalCode, row.chainName]
				.filter(Boolean)
				.join(" ") || null,
		imageUrl: null,
	});
}

export async function indexRetailerItemsBatch(
	itemIds: string[],
): Promise<number> {
	if (itemIds.length === 0) return 0;

	const db = getDb();
	const batchSize = 500;
	let indexed = 0;

	for (let index = 0; index < itemIds.length; index += batchSize) {
		const batchIds = itemIds.slice(index, index + batchSize);

		const items = await db
			.select()
			.from(retailerItems)
			.where(inArray(retailerItems.id, batchIds));
		const links = await db
			.select({ retailerItemId: skuItemLinks.retailerItemId })
			.from(skuItemLinks)
			.where(inArray(skuItemLinks.retailerItemId, batchIds));
		const linkedItemIds = new Set(links.map((link) => link.retailerItemId));
		const staleItemIds = new Set<string>();
		const itemsToIndex = items.filter((item) => {
			if (item.mergedIntoId || linkedItemIds.has(item.id)) {
				staleItemIds.add(item.id);
				return false;
			}
			return true;
		});

		if (items.length === 0) continue;

		if (staleItemIds.size > 0) {
			await db
				.delete(searchIndex)
				.where(
					and(
						eq(searchIndex.entityType, "item"),
						inArray(searchIndex.entityId, Array.from(staleItemIds)),
					),
				);
		}

		const values = itemsToIndex.map((item) => ({
			id: generatePrefixedId("six"),
			entityType: "item" as const,
			entityId: item.id,
			chainSlug: item.chainSlug ?? null,
			category: item.category ?? null,
			subcategory: item.subcategory ?? null,
			title: item.name,
			subtitle: item.brand ?? null,
			body:
				[item.description, item.category, item.subcategory, item.brand]
					.filter(Boolean)
					.join(" ") || null,
			imageUrl: item.imageUrl ?? null,
			updatedAt: new Date(),
		}));

		if (values.length > 0) {
			await db
				.insert(searchIndex)
				.values(values)
				.onConflictDoUpdate({
					target: [searchIndex.entityType, searchIndex.entityId],
					set: {
						chainSlug: sql`excluded.chain_slug`,
						category: sql`excluded.category`,
						subcategory: sql`excluded.subcategory`,
						title: sql`excluded.title`,
						subtitle: sql`excluded.subtitle`,
						body: sql`excluded.body`,
						imageUrl: sql`excluded.image_url`,
						updatedAt: sql`excluded.updated_at`,
					},
				});
		}

		indexed += itemsToIndex.length;
	}

	log.info("Batch indexed retailer items", { indexed, total: itemIds.length });
	return indexed;
}

export async function indexCanonicalSkusBatch(skuIds: string[]): Promise<number> {
	if (skuIds.length === 0) return 0;

	const db = getDb();
	const skuRows = await db
		.select({
			id: canonicalSkus.id,
			baseProductId: canonicalSkus.baseProductId,
			isBaseProduct: canonicalSkus.isBaseProduct,
		})
		.from(canonicalSkus)
		.where(inArray(canonicalSkus.id, skuIds));

	const targetProductIds = Array.from(
		new Set(
			skuRows
				.map((sku) => (sku.isBaseProduct ? sku.id : sku.baseProductId))
				.filter((id): id is string => Boolean(id)),
		),
	);
	if (targetProductIds.length === 0) {
		return 0;
	}

	const skus = await db
		.select({
			id: canonicalSkus.id,
			canonicalName: canonicalSkus.canonicalName,
			productType: canonicalSkus.productType,
		})
		.from(canonicalSkus)
		.where(
			and(
				inArray(canonicalSkus.id, targetProductIds),
				eq(canonicalSkus.isBaseProduct, true),
				isNull(canonicalSkus.mergedIntoId),
			),
		);

	const values = skus
		.filter((sku) => sku.canonicalName.length > 0)
		.map((sku) => ({
			id: generatePrefixedId("six"),
			entityType: "product" as const,
			entityId: sku.id,
			chainSlug: null,
			category: sku.productType ?? "product",
			subcategory: null,
			title: sku.canonicalName,
			subtitle: null,
			body:
				[sku.canonicalName, sku.productType].filter(Boolean).join(" ") || null,
			imageUrl: null,
			updatedAt: new Date(),
		}));

	if (values.length === 0) {
		return 0;
	}

	await db
		.insert(searchIndex)
		.values(values)
		.onConflictDoUpdate({
			target: [searchIndex.entityType, searchIndex.entityId],
			set: {
				chainSlug: sql`excluded.chain_slug`,
				category: sql`excluded.category`,
				subcategory: sql`excluded.subcategory`,
				title: sql`excluded.title`,
				subtitle: sql`excluded.subtitle`,
				body: sql`excluded.body`,
				imageUrl: sql`excluded.image_url`,
				updatedAt: sql`excluded.updated_at`,
			},
		});

	return values.length;
}

export async function removeFromSearchIndex(
	entityType: SearchEntityType,
	entityId: string,
): Promise<void> {
	const db = getDb();

	await db
		.delete(searchIndex)
		.where(
			and(
				eq(searchIndex.entityType, entityType),
				eq(searchIndex.entityId, entityId),
			),
		);
}
