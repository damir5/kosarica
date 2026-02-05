import { and, eq, inArray, sql } from "drizzle-orm";
import {
	chains,
	products,
	retailerItems,
	searchIndex,
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

	const [product] = await db
		.select()
		.from(products)
		.where(eq(products.id, productId))
		.limit(1);

	if (!product) {
		log.warn("Product not found for indexing", { productId });
		return;
	}

	await upsertSearchIndex({
		entityType: "product",
		entityId: product.id,
		chainSlug: null,
		category: product.category ?? null,
		subcategory: product.subcategory ?? null,
		title: product.name,
		subtitle: product.brand ?? null,
		body:
			[product.description, product.category, product.subcategory]
				.filter(Boolean)
				.join(" ") || null,
		imageUrl: product.imageUrl ?? null,
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

		if (items.length === 0) continue;

		const values = items.map((item) => ({
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

		indexed += items.length;
	}

	log.info("Batch indexed retailer items", { indexed, total: itemIds.length });
	return indexed;
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
