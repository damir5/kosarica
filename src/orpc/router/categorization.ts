import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { retailerItemFeatures, retailerItems } from "@/db/schema";
import { backfillUncategorizedItems } from "@/lib/categorization";
import { parseRetailerItemFeature } from "@/lib/semantic-clustering/normalize";
import { scheduleTask } from "@/lib/taskqueue";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { superadminProcedure } from "../base";

type StatusFilter = "all" | "pending" | "escalated" | "done";

function parsePositiveNumber(value: number | null, fallback: number): number {
	if (value == null || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return value;
}

function toBaseUnitAmount(amount: number, unit: string): number {
	switch (unit) {
		case "g":
			return amount / 1000;
		case "kg":
			return amount;
		case "ml":
			return amount / 1000;
		case "l":
			return amount;
		case "kom":
			return amount;
		default:
			return amount;
	}
}

export const listCategorizations = superadminProcedure
	.input(
		z.object({
			chainSlug: z.string().optional(),
			status: z.enum(["all", "pending", "escalated", "done"]).default("all"),
			productType: z.string().optional(),
			limit: z.number().int().min(1).max(200).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const conditions = [sql`ri.merged_into_id IS NULL`];

		if (input.chainSlug) {
			conditions.push(sql`ri.chain_slug = ${input.chainSlug}`);
		}
		if (input.productType) {
			conditions.push(sql`rif.product_type = ${input.productType}`);
		}

		const status = input.status as StatusFilter;
		if (status === "pending") {
			conditions.push(
				sql`(rif.retailer_item_id IS NULL OR rif.categorized_at IS NULL)`,
			);
		}
		if (status === "escalated") {
			conditions.push(sql`COALESCE(rif.categorization_needs_review, false) = true`);
		}
		if (status === "done") {
			conditions.push(
				sql`(rif.categorized_at IS NOT NULL AND COALESCE(rif.categorization_needs_review, false) = false)`,
			);
		}

		const whereSql = sql.join(conditions, sql` AND `);

		const rowsResult = await db.execute(sql`
			SELECT
				ri.id AS item_id,
				ri.chain_slug AS chain_slug,
				ri.name AS original_name,
				rif.everyday_name,
				rif.product_type,
				rif.extracted_brand,
				rif.variant,
				rif.extracted_amount,
				rif.extracted_unit,
				rif.pack_amount,
				rif.container_type,
				rif.search_tags,
				rif.categorized_at,
				rif.categorization_model,
				rif.categorization_confidence,
				rif.categorization_needs_review
			FROM retailer_items ri
			LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
			WHERE ${whereSql}
			ORDER BY ri.created_at DESC
			LIMIT ${input.limit}
			OFFSET ${input.offset}
		`);
		const totalResult = await db.execute(sql`
			SELECT count(*)::int AS count
			FROM retailer_items ri
			LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
			WHERE ${whereSql}
		`);

		const rows = ((rowsResult as { rows?: unknown[] }).rows ?? []) as Array<{
			item_id: string;
			chain_slug: string | null;
			original_name: string;
			everyday_name: string | null;
			product_type: string | null;
			extracted_brand: string | null;
			variant: string | null;
			extracted_amount: number | null;
			extracted_unit: string | null;
			pack_amount: number | null;
			container_type: string | null;
			search_tags: string[] | null;
			categorized_at: Date | null;
			categorization_model: string | null;
			categorization_confidence: number | null;
			categorization_needs_review: boolean | null;
		}>;
		const totalRow = ((totalResult as { rows?: unknown[] }).rows ?? [])[0] as
			| { count?: number }
			| undefined;

		return {
			items: rows.map((row) => ({
				itemId: row.item_id,
				chainSlug: row.chain_slug,
				originalName: row.original_name,
				everydayName: row.everyday_name,
				productType: row.product_type,
				brand: row.extracted_brand,
				variant: row.variant,
				extractedAmount: row.extracted_amount,
				extractedUnit: row.extracted_unit,
				packAmount: row.pack_amount,
				containerType: row.container_type,
				searchTags: row.search_tags ?? [],
				categorizedAt: row.categorized_at,
				model: row.categorization_model,
				confidence: row.categorization_confidence,
				needsReview: Boolean(row.categorization_needs_review),
			})),
			total: Number(totalRow?.count ?? 0),
			limit: input.limit,
			offset: input.offset,
		};
	});

export const getStats = superadminProcedure.handler(async () => {
	const db = getDb();
	const result = await db.execute(sql`
		SELECT
			COUNT(*)::int AS total,
			COUNT(*) FILTER (WHERE rif.categorized_at IS NOT NULL)::int AS categorized,
			COUNT(*) FILTER (
				WHERE rif.retailer_item_id IS NULL OR rif.categorized_at IS NULL
			)::int AS pending,
			COUNT(*) FILTER (
				WHERE COALESCE(rif.categorization_needs_review, false) = true
			)::int AS escalated
		FROM retailer_items ri
		LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ri.merged_into_id IS NULL
	`);
	const row = ((result as { rows?: unknown[] }).rows ?? [])[0] as
		| {
				total?: number;
				categorized?: number;
				pending?: number;
				escalated?: number;
		  }
		| undefined;

	return {
		total: Number(row?.total ?? 0),
		categorized: Number(row?.categorized ?? 0),
		pending: Number(row?.pending ?? 0),
		escalated: Number(row?.escalated ?? 0),
	};
});

export const updateCategorization = superadminProcedure
	.input(
		z.object({
			itemId: z.string().min(1),
			fields: z
				.object({
					everydayName: z.string().nullable().optional(),
					productType: z.string().nullable().optional(),
					brand: z.string().nullable().optional(),
					variant: z.string().nullable().optional(),
					extractedAmount: z.number().nullable().optional(),
					extractedUnit: z
						.enum(["g", "kg", "ml", "l", "kom"])
						.nullable()
						.optional(),
					packAmount: z.number().int().min(1).max(999).nullable().optional(),
					containerType: z
						.enum(["pet", "limenka", "staklo", "tetrapak", "tuba"])
						.nullable()
						.optional(),
					searchTags: z.array(z.string()).max(10).optional(),
				})
				.refine((value) => Object.keys(value).length > 0, {
					message: "At least one field must be provided",
				}),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const [item] = await db
			.select({
				id: retailerItems.id,
				name: retailerItems.name,
				brand: retailerItems.brand,
				category: retailerItems.category,
				unit: retailerItems.unit,
				unitQuantity: retailerItems.unitQuantity,
			})
			.from(retailerItems)
			.where(eq(retailerItems.id, input.itemId))
			.limit(1);
		if (!item) {
			throw new Error(`Retailer item not found: ${input.itemId}`);
		}

		const [existingFeature] = await db
			.select()
			.from(retailerItemFeatures)
			.where(eq(retailerItemFeatures.retailerItemId, input.itemId))
			.limit(1);

		const everydayName =
			input.fields.everydayName ??
			existingFeature?.everydayName ??
			item.name;
		const brand = input.fields.brand ?? existingFeature?.extractedBrand ?? item.brand;
		const featureInput = parseRetailerItemFeature({
			retailerItemId: item.id,
			name: everydayName ?? item.name,
			brand,
			category: item.category,
			unit: item.unit,
			unitQuantity: item.unitQuantity,
		});

		const packAmount = parsePositiveNumber(
			input.fields.packAmount ?? existingFeature?.packAmount ?? featureInput.packAmount,
			1,
		);
		const extractedAmount =
			input.fields.extractedAmount ??
			existingFeature?.extractedAmount ??
			featureInput.extractedAmount;
		const extractedUnit =
			input.fields.extractedUnit ??
			existingFeature?.extractedUnit ??
			featureInput.extractedUnit;
		const hasAmountData =
			extractedAmount != null &&
			Number.isFinite(extractedAmount) &&
			extractedAmount > 0 &&
			(extractedUnit === "g" ||
				extractedUnit === "kg" ||
				extractedUnit === "ml" ||
				extractedUnit === "l" ||
				extractedUnit === "kom");

			const unitAmount = hasAmountData
				? toBaseUnitAmount(extractedAmount as number, extractedUnit as string)
				: featureInput.unitAmount;
			const totalAmount = hasAmountData
				? (unitAmount ?? 0) * packAmount
				: featureInput.totalAmount;
		const categorizedAt = new Date();

		await db
			.insert(retailerItemFeatures)
			.values({
				id: generatePrefixedId("rif"),
				retailerItemId: input.itemId,
				normalizedName: featureInput.normalizedName,
				normalizedCategory: featureInput.normalizedCategory,
				extractedBrand: brand ?? featureInput.extractedBrand,
				extractedAmount,
				extractedUnit,
				isCountItem: hasAmountData
					? extractedUnit === "kom"
					: featureInput.isCountItem,
				isMultipack: packAmount > 1,
				packAmount,
				unitAmount,
				totalAmount,
				containerType:
					input.fields.containerType ??
					existingFeature?.containerType ??
					featureInput.containerType,
				blockingKeys: featureInput.blockingKeys,
				everydayName,
				productType: input.fields.productType ?? existingFeature?.productType ?? null,
				variant: input.fields.variant ?? existingFeature?.variant ?? null,
				searchTags: input.fields.searchTags ?? existingFeature?.searchTags ?? [],
				categorizedAt,
				categorizationModel: "manual-override",
				categorizationConfidence: 1,
				categorizationNeedsReview: false,
			})
			.onConflictDoUpdate({
				target: [retailerItemFeatures.retailerItemId],
				set: {
					normalizedName: featureInput.normalizedName,
					normalizedCategory: featureInput.normalizedCategory,
					extractedBrand: brand ?? featureInput.extractedBrand,
					extractedAmount,
					extractedUnit,
					isCountItem: hasAmountData
						? extractedUnit === "kom"
						: featureInput.isCountItem,
					isMultipack: packAmount > 1,
					packAmount,
					unitAmount,
					totalAmount,
					containerType:
						input.fields.containerType ??
						existingFeature?.containerType ??
						featureInput.containerType,
					blockingKeys: featureInput.blockingKeys,
					everydayName,
					productType:
						input.fields.productType ?? existingFeature?.productType ?? null,
					variant: input.fields.variant ?? existingFeature?.variant ?? null,
					searchTags: input.fields.searchTags ?? existingFeature?.searchTags ?? [],
					categorizedAt,
					categorizationModel: "manual-override",
					categorizationConfidence: 1,
					categorizationNeedsReview: false,
				},
			});

		return { success: true };
	});

export const triggerCategorization = superadminProcedure
	.input(
		z
			.object({
				runId: z.string().optional(),
				chainSlug: z.string().optional(),
				batchSize: z.number().int().min(1).max(5000).optional(),
				maxBatches: z.number().int().min(1).max(1000).optional(),
				async: z.boolean().optional(),
			})
			.optional(),
	)
	.handler(async ({ input }) => {
		if (input?.runId && input.chainSlug) {
			const task = await scheduleTask({
				taskType: "categorize",
				payload: {
					type: "categorize",
					runId: input.runId,
					chainSlug: input.chainSlug,
				},
			});
			return { queued: true, taskId: task.id };
		}

		if (input?.async) {
			const task = await scheduleTask({
				taskType: "categorize",
				payload: {
					type: "categorize",
					chainSlug: input.chainSlug,
					batchSize: input.batchSize,
					maxBatches: input.maxBatches,
				},
			});
			return { queued: true, taskId: task.id };
		}

		const result = await backfillUncategorizedItems({
			batchSize: input?.batchSize,
			maxBatches: input?.maxBatches,
			chainSlug: input?.chainSlug,
		});
		return {
			queued: false,
			result,
		};
	});
