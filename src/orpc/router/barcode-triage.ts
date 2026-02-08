import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
	barcodeSkuMappings,
	canonicalSkus,
	retailerItemBarcodes,
	retailerItemFeatures,
	retailerItems,
	skuItemLinks,
} from "@/db/schema";
import { logCatalogEvent } from "@/lib/catalog-events";
import { getLatestEffectivePricesByItemId } from "@/lib/clickhouse/latest-prices";
import { logLlmDecision } from "@/lib/llm-observability";
import { getDb } from "@/utils/bindings";
import { superadminProcedure, type AuthenticatedContext } from "../base";

const queueFiltersSchema = z.object({
	limit: z.number().int().min(1).max(200).default(50),
	offset: z.number().int().min(0).default(0),
	chainSlug: z.string().optional(),
	category: z.string().optional(),
	minPriority: z.number().int().optional(),
	status: z.enum(["all", "mine", "unclaimed"]).default("all"),
});

type QueueRow = {
	barcode: string;
	chain_count: number | string;
	item_count: number | string;
	category_agreement: number | string | null;
	price_variance: number | string | null;
	priority_score: number | string;
	claimed_by: string | null;
	claimed_at: Date | null;
	expires_at: Date | null;
};

function getContextUserId(context: unknown): string {
	return (context as AuthenticatedContext).user.id;
}

function getRows<T>(result: unknown): T[] {
	if (Array.isArray(result)) {
		return result as T[];
	}
	return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function escapeLikePattern(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export const getTriageQueue = superadminProcedure
	.input(queueFiltersSchema)
	.handler(async ({ input, context }) => {
		const db = getDb();
		const userId = getContextUserId(context);
		const chainFilter = input.chainSlug
			? sql`AND EXISTS (
				SELECT 1
				FROM retailer_item_barcodes rib
				JOIN retailer_items ri ON ri.id = rib.retailer_item_id
				WHERE rib.barcode = q.barcode
				AND ri.chain_slug = ${input.chainSlug}
			)`
			: sql``;
		const categoryFilter = input.category
			? sql`AND EXISTS (
				SELECT 1
				FROM retailer_item_barcodes rib
				JOIN retailer_item_features rif ON rif.retailer_item_id = rib.retailer_item_id
				WHERE rib.barcode = q.barcode
				AND rif.normalized_category = ${input.category}
			)`
			: sql``;
		const priorityFilter =
			input.minPriority != null
				? sql`AND q.priority_score >= ${input.minPriority}`
				: sql``;
		const statusFilter =
			input.status === "mine"
				? sql`AND c.claimed_by = ${userId} AND c.expires_at > NOW()`
				: input.status === "unclaimed"
					? sql`AND (c.barcode IS NULL OR c.expires_at <= NOW())`
					: sql``;

		const queueResult = await db.execute(sql`
			SELECT
				q.barcode,
				q.chain_count,
				q.item_count,
				q.category_agreement,
				q.price_variance,
				q.priority_score,
				c.claimed_by,
				c.claimed_at,
				c.expires_at
			FROM barcode_triage_queue q
			LEFT JOIN barcode_triage_claims c ON c.barcode = q.barcode
			WHERE 1=1
				${chainFilter}
				${categoryFilter}
				${priorityFilter}
				${statusFilter}
				AND (c.claimed_by IS NULL OR c.claimed_by = ${userId} OR c.expires_at <= NOW())
			ORDER BY q.priority_score DESC
			LIMIT ${input.limit}
			OFFSET ${input.offset}
		`);

		const countResult = await db.execute(sql`
			SELECT COUNT(*)::int AS count
			FROM barcode_triage_queue q
			LEFT JOIN barcode_triage_claims c ON c.barcode = q.barcode
			WHERE 1=1
				${chainFilter}
				${categoryFilter}
				${priorityFilter}
				${statusFilter}
				AND (c.claimed_by IS NULL OR c.claimed_by = ${userId} OR c.expires_at <= NOW())
		`);

		const rows = getRows<QueueRow>(queueResult);
		const [count] = getRows<{ count: number | string }>(countResult);

		return {
			items: rows.map((row) => ({
				barcode: row.barcode,
				chainCount: Number(row.chain_count),
				itemCount: Number(row.item_count),
				categoryAgreement:
					row.category_agreement == null ? null : Number(row.category_agreement),
				priceVariance:
					row.price_variance == null ? null : Number(row.price_variance),
				priorityScore: Number(row.priority_score),
				claimedBy: row.claimed_by,
				claimedAt: row.claimed_at,
				expiresAt: row.expires_at,
			})),
			total: Number(count?.count ?? 0),
		};
	});

export const claimTriageItem = superadminProcedure
	.input(z.object({ barcode: z.string().min(4) }))
	.handler(async ({ input, context }) => {
		const db = getDb();
		const userId = getContextUserId(context);
		const claimResult = await db.execute(sql`
			INSERT INTO barcode_triage_claims (barcode, claimed_by, claimed_at, expires_at, updated_at)
			VALUES (
				${input.barcode},
				${userId},
				NOW(),
				NOW() + INTERVAL '30 minutes',
				NOW()
			)
			ON CONFLICT (barcode) DO UPDATE
			SET
				claimed_by = EXCLUDED.claimed_by,
				claimed_at = EXCLUDED.claimed_at,
				expires_at = EXCLUDED.expires_at,
				updated_at = NOW()
			WHERE barcode_triage_claims.claimed_by = EXCLUDED.claimed_by
				OR barcode_triage_claims.expires_at <= NOW()
			RETURNING barcode, claimed_by, claimed_at, expires_at
		`);

		const rows = getRows<{
			barcode: string;
			claimed_by: string;
			claimed_at: Date;
			expires_at: Date;
		}>(claimResult);
		if (rows.length === 0) {
			throw new Error("This barcode is currently claimed by another reviewer");
		}

		return {
			barcode: rows[0].barcode,
			claimedBy: rows[0].claimed_by,
			claimedAt: rows[0].claimed_at,
			expiresAt: rows[0].expires_at,
		};
	});

export const getClusterDetail = superadminProcedure
	.input(z.object({ barcode: z.string().min(4) }))
	.handler(async ({ input }) => {
		const db = getDb();
		const items = await db
			.select({
				retailerItemId: retailerItems.id,
				name: retailerItems.name,
				brand: retailerItems.brand,
				category: retailerItemFeatures.normalizedCategory,
				chainSlug: retailerItems.chainSlug,
				totalAmount: retailerItemFeatures.totalAmount,
				extractedUnit: retailerItemFeatures.extractedUnit,
				packAmount: retailerItemFeatures.packAmount,
				containerType: retailerItemFeatures.containerType,
			})
			.from(retailerItemBarcodes)
			.innerJoin(
				retailerItems,
				eq(retailerItemBarcodes.retailerItemId, retailerItems.id),
			)
			.leftJoin(
				retailerItemFeatures,
				eq(retailerItemFeatures.retailerItemId, retailerItems.id),
			)
			.where(eq(retailerItemBarcodes.barcode, input.barcode));

		if (items.length === 0) {
			return {
				barcode: input.barcode,
				items: [],
			};
		}

		const priceMap = await getLatestEffectivePricesByItemId(
			items.map((item) => item.retailerItemId),
			{ includeNonPositive: true },
		);

		return {
			barcode: input.barcode,
			items: items.map((item) => ({
				...item,
				priceCents: priceMap.get(item.retailerItemId) ?? null,
			})),
		};
	});

export const searchCanonicalSkus = superadminProcedure
	.input(
		z.object({
			query: z.string().min(1),
			limit: z.number().int().min(1).max(50).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const query = `%${escapeLikePattern(input.query)}%`;
		const rows = await db
			.select({
				id: canonicalSkus.id,
				canonicalName: canonicalSkus.canonicalName,
				brand: canonicalSkus.brand,
				status: canonicalSkus.status,
				matchPolicy: canonicalSkus.matchPolicy,
			})
			.from(canonicalSkus)
			.where(sql`${canonicalSkus.canonicalName} ILIKE ${query} ESCAPE '\\'`)
			.limit(input.limit);
		return { items: rows };
	});

const decisionSchema = z.discriminatedUnion("decisionType", [
	z.object({
		decisionType: z.literal("map_existing_sku"),
		barcode: z.string(),
		canonicalSkuId: z.string(),
	}),
	z.object({
		decisionType: z.literal("create_new_sku"),
		barcode: z.string(),
		canonicalName: z.string().min(2),
		brand: z.string().optional(),
		productType: z.string().optional(),
		normalizedUnit: z.string().optional(),
		normalizedQuantity: z.number().optional(),
		packAmount: z.number().int().positive().default(1),
		containerType: z.string().optional(),
	}),
	z.object({
		decisionType: z.literal("same_base_different_pack"),
		barcode: z.string(),
		baseSkuId: z.string(),
		canonicalName: z.string().min(2),
		packAmount: z.number().int().positive().default(1),
	}),
	z.object({
		decisionType: z.literal("not_match"),
		barcode: z.string(),
		reason: z.enum([
			"category_mismatch",
			"price_outlier",
			"different_product",
			"data_error",
		]),
	}),
	z.object({
		decisionType: z.literal("mark_non_comparable"),
		barcode: z.string(),
		canonicalSkuId: z.string().optional(),
	}),
]);

export const submitDecision = superadminProcedure
	.input(decisionSchema)
	.handler(async ({ input, context }) => {
		const db = getDb();
		const userId = getContextUserId(context);
		const itemRows = await db
			.select({ retailerItemId: retailerItemBarcodes.retailerItemId })
			.from(retailerItemBarcodes)
			.where(eq(retailerItemBarcodes.barcode, input.barcode));
		const retailerItemIds = itemRows.map((row) => row.retailerItemId);
		if (retailerItemIds.length === 0) {
			throw new Error("No retailer items found for barcode");
		}

		if (input.decisionType === "not_match") {
			await logCatalogEvent({
				eventType: "decision_overridden",
				entityType: "barcode_mapping",
				entityId: input.barcode,
				actorId: userId,
				payload: {
					barcode: input.barcode,
					decisionType: input.decisionType,
					reason: input.reason,
				},
			});
			await logLlmDecision({
				taskType: "barcode_assign",
				input: { barcode: input.barcode, retailerItemIds },
				output: { decision: "not_match", reason: input.reason },
				modelId: "human-review",
				provider: "manual",
				verdict: "NOT_MATCH",
				confidence: 1,
				reasoning: input.reason,
				reviewedBy: userId,
				reviewedAt: new Date(),
			});
			return { success: true, skuId: null };
		}

		const skuId = await db.transaction(async (tx) => {
			if (input.decisionType === "map_existing_sku") {
				return input.canonicalSkuId;
			}

			if (input.decisionType === "mark_non_comparable") {
				if (input.canonicalSkuId) {
					await tx
						.update(canonicalSkus)
						.set({
							matchPolicy: "non_comparable",
							updatedAt: new Date(),
						})
						.where(eq(canonicalSkus.id, input.canonicalSkuId));
					return input.canonicalSkuId;
				}
			}

			if (input.decisionType === "same_base_different_pack") {
				const [created] = await tx
					.insert(canonicalSkus)
					.values({
						canonicalName: input.canonicalName,
						baseProductId: input.baseSkuId,
						packAmount: input.packAmount,
						isBaseProduct: false,
						status: "active",
						matchPolicy: "matchable",
						createdBy: userId,
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.returning({ id: canonicalSkus.id });
				return created.id;
			}

			if (input.decisionType === "create_new_sku") {
				const [created] = await tx
					.insert(canonicalSkus)
					.values({
						canonicalName: input.canonicalName,
						brand: input.brand ?? null,
						productType: input.productType ?? null,
						normalizedUnit: input.normalizedUnit ?? null,
						normalizedQuantity: input.normalizedQuantity ?? null,
						packAmount: input.packAmount,
						containerType: input.containerType ?? null,
						isBaseProduct: true,
						status: "active",
						matchPolicy: "matchable",
						createdBy: userId,
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.returning({ id: canonicalSkus.id });
				return created.id;
			}

			const [created] = await tx
				.insert(canonicalSkus)
				.values({
					canonicalName: `Non-comparable ${input.barcode}`,
					packAmount: 1,
					isBaseProduct: true,
					status: "active",
					matchPolicy: "non_comparable",
					createdBy: userId,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.returning({ id: canonicalSkus.id });
			return created.id;
		});

		await db.transaction(async (tx) => {
			await tx
				.delete(skuItemLinks)
				.where(inArray(skuItemLinks.retailerItemId, retailerItemIds));

			await tx
				.insert(skuItemLinks)
				.values(
					retailerItemIds.map((retailerItemId) => ({
						canonicalSkuId: skuId,
						retailerItemId,
						linkType: "manual",
						confidence: 1,
						createdBy: userId,
						createdAt: new Date(),
					})),
				)
				.onConflictDoNothing({ target: skuItemLinks.retailerItemId });

			await tx
				.insert(barcodeSkuMappings)
				.values({
					barcode: input.barcode,
					canonicalSkuId: skuId,
					confidence: 1,
					source: "manual",
					verifiedBy: userId,
					verifiedAt: new Date(),
					createdBy: userId,
					createdAt: new Date(),
				})
				.onConflictDoUpdate({
					target: barcodeSkuMappings.barcode,
					set: {
						canonicalSkuId: skuId,
						confidence: 1,
						source: "manual",
						verifiedBy: userId,
						verifiedAt: new Date(),
					},
				});
		});

		await logCatalogEvent({
			eventType: "item_linked",
			entityType: "canonical_sku",
			entityId: skuId,
			actorId: userId,
			payload: {
				barcode: input.barcode,
				decisionType: input.decisionType,
				retailerItemIds,
			},
		});

		await logLlmDecision({
			taskType: "barcode_assign",
			input: {
				barcode: input.barcode,
				retailerItemIds,
			},
			output: {
				decisionType: input.decisionType,
				skuId,
			},
			modelId: "human-review",
			provider: "manual",
			verdict: "MANUAL",
			confidence: 1,
			reasoning: input.decisionType,
			reviewedBy: userId,
			reviewedAt: new Date(),
		});

		return {
			success: true,
			skuId,
		};
	});

export const revertDecision = superadminProcedure
	.input(z.object({ barcode: z.string().min(4) }))
	.handler(async ({ input, context }) => {
		const db = getDb();
		const userId = getContextUserId(context);
		const [mapping] = await db
			.select({
				id: barcodeSkuMappings.id,
				canonicalSkuId: barcodeSkuMappings.canonicalSkuId,
			})
			.from(barcodeSkuMappings)
			.where(eq(barcodeSkuMappings.barcode, input.barcode))
			.limit(1);

		if (!mapping) {
			return { success: true, removedLinks: 0 };
		}

		const itemRows = await db
			.select({ retailerItemId: retailerItemBarcodes.retailerItemId })
			.from(retailerItemBarcodes)
			.where(eq(retailerItemBarcodes.barcode, input.barcode));
		const itemIds = itemRows.map((row) => row.retailerItemId);

		const removedLinks = await db
			.delete(skuItemLinks)
			.where(
				and(
					eq(skuItemLinks.canonicalSkuId, mapping.canonicalSkuId),
					inArray(skuItemLinks.retailerItemId, itemIds),
				),
			)
			.returning({ retailerItemId: skuItemLinks.retailerItemId });
		await db
			.delete(barcodeSkuMappings)
			.where(eq(barcodeSkuMappings.id, mapping.id));

		await logCatalogEvent({
			eventType: "item_unlinked",
			entityType: "barcode_mapping",
			entityId: mapping.id,
			actorId: userId,
			payload: {
				barcode: input.barcode,
				removedItemIds: removedLinks.map((row) => row.retailerItemId),
			},
		});

		return {
			success: true,
			removedLinks: removedLinks.length,
		};
	});

export const getDecisionHistory = superadminProcedure
	.input(
		z.object({
			barcode: z.string().min(4),
			limit: z.number().int().min(1).max(200).default(50),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const result = await db.execute(sql`
			SELECT
				id,
				event_type,
				entity_type,
				entity_id,
				actor_id,
				payload,
				created_at
			FROM catalog_events
			WHERE payload::text ILIKE ${`%${input.barcode}%`}
			ORDER BY created_at DESC
			LIMIT ${input.limit}
		`);
		type Row = {
			id: string;
			event_type: string;
			entity_type: string;
			entity_id: string;
			actor_id: string | null;
			payload: unknown;
			created_at: Date;
		};

		return {
			items: getRows<Row>(result).map((row) => ({
				id: row.id,
				eventType: row.event_type,
				entityType: row.entity_type,
				entityId: row.entity_id,
				actorId: row.actor_id,
				payload: row.payload,
				createdAt: row.created_at,
			})),
		};
	});
