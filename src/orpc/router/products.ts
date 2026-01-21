import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { superadminProcedure } from "../base";
import { getDb } from "@/utils/bindings";
import {
	productMatchQueue,
	productMatchCandidates,
	productMatchRejections,
	productLinks,
	productMatchAudit,
} from "@/db/schema";

// Schema for input validation
const approveMatchSchema = z.object({
	queueId: z.string(),
	productId: z.string().optional(),
	notes: z.string().optional(),
	version: z.number(),
});

const rejectMatchSchema = z.object({
	queueId: z.string(),
	productId: z.string().optional(),
	reason: z.string().optional(),
	version: z.number(),
});

const bulkApproveSchema = z.object({
	queueIds: z.array(z.string()),
});

const resolveSuspiciousSchema = z.object({
	queueId: z.string(),
	productId: z.string(),
	version: z.number(),
	notes: z.string().optional(),
});

// Get pending matches with candidates for review
// Uses set-based query with JSON aggregation to avoid N+1
export const getPendingMatches = superadminProcedure
	.input(
		z.object({
			limit: z.number().default(20),
			cursor: z.string().optional(), // Keyset pagination
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		// Keyset pagination with cursor
		const whereClause = input.cursor
			? sql`q.status = 'pending' AND q.created_at > ${new Date(input.cursor)}`
			: sql`q.status = 'pending'`;

		// Set-based query with JSON aggregation for candidates
		const result = await db.execute(
			sql`
				WITH pending AS (
					SELECT q.*
					FROM product_match_queue q
					WHERE ${whereClause}
					ORDER BY q.created_at
					LIMIT ${input.limit + 1}
				)
				SELECT
					q.id,
					q.status,
					q.decision,
					q.linked_product_id,
					q.review_notes,
					q.created_at,
					q.version,
					jsonb_build_object(
						'id', ri.id,
						'name', ri.name,
						'barcode', COALESCE((
							SELECT barcode FROM retailer_item_barcodes
							WHERE retailer_item_id = ri.id AND is_primary = true
							LIMIT 1
						), ''),
						'brand', ri.brand,
						'unit', ri.unit,
						'unitQuantity', ri.unit_quantity,
						'imageUrl', ri.image_url,
						'chainName', ch.name,
						'chainSlug', ch.slug
					) as retailer_item,
					COALESCE(
						(
							SELECT jsonb_agg(
								jsonb_build_object(
									'candidateProductId', c.candidate_product_id,
									'similarity', c.similarity::text,
									'rank', c.rank,
									'matchType', c.match_type,
									'flags', c.flags,
									'product', jsonb_build_object(
										'id', p.id,
										'name', p.name,
										'brand', p.brand,
										'category', p.category,
										'imageUrl', p.image_url
									)
								) ORDER BY c.rank
							)
							FROM product_match_candidates c
							JOIN products p ON p.id = c.candidate_product_id
							WHERE c.retailer_item_id = q.retailer_item_id
								AND c.rank <= 5
						),
						'[]'::jsonb
					) as candidates
				FROM pending q
				JOIN retailer_items ri ON ri.id = q.retailer_item_id
				JOIN chains ch ON ch.slug = ri.chain_slug
				ORDER BY q.created_at
			`,
		);

		const rows: any[] = (result as any).rows ?? [];

		// Check if there are more results
		const hasMore = rows.length > input.limit;
		const items = hasMore ? rows.slice(0, input.limit) : rows;
		const nextCursor = hasMore ? items[items.length - 1].created_at : undefined;

		return {
			items,
			nextCursor,
			hasMore,
		};
	});

// Get count of pending matches
export const getPendingMatchCount = superadminProcedure.handler(async () => {
	const db = getDb();
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(productMatchQueue)
		.where(eq(productMatchQueue.status, "pending"));

	return result[0]?.count ?? 0;
});

// Approve a match and create product link
export const approveMatch = superadminProcedure
	.input(approveMatchSchema)
	.handler(async ({ input, context }) => {
		const db = getDb();

		return await db.transaction(async (tx) => {
			// Check version for optimistic locking
			const [queue] = await tx
				.select()
				.from(productMatchQueue)
				.where(
					and(
						eq(productMatchQueue.id, input.queueId),
						eq(productMatchQueue.version, input.version),
					),
				);

			if (!queue) {
				throw new Error(
					"Queue item was modified by another user. Please refresh.",
				);
			}

			if (queue.status !== "pending") {
				throw new Error("Queue item already processed");
			}

			// Get the current user ID from context
			const userId = (context as { user: { id: string } }).user?.id;

			// If productId is not provided, use the best candidate
			const productId =
				input.productId ??
				queue.linkedProductId ??
				(
					await tx
						.select({ candidateProductId: productMatchCandidates.candidateProductId })
						.from(productMatchCandidates)
						.where(
							and(
								eq(productMatchCandidates.retailerItemId, queue.retailerItemId),
								eq(productMatchCandidates.rank, 1),
							),
						)
						.limit(1)
				)[0]?.candidateProductId;

			if (!productId) {
				throw new Error("No product specified or available");
			}

			// Create link (unique constraint prevents duplicates)
			await tx.insert(productLinks).values({
				productId,
				retailerItemId: queue.retailerItemId,
				confidence: "manual",
			});

			// Update queue with version increment
			await tx
				.update(productMatchQueue)
				.set({
					status: "approved",
					decision: "linked",
					linkedProductId: productId,
					reviewedBy: userId,
					reviewedAt: new Date(),
					reviewNotes: input.notes,
					version: (queue.version ?? 1) + 1,
				})
				.where(eq(productMatchQueue.id, input.queueId));

			// Audit log
			await tx.insert(productMatchAudit).values({
				queueId: input.queueId,
				action: "approved",
				userId,
				previousState: JSON.stringify({ status: queue.status }),
				newState: JSON.stringify({ status: "approved", productId }),
			});

			return { success: true, productId };
		});
	});

// Reject a match (specific candidate or entire item)
export const rejectMatch = superadminProcedure
	.input(rejectMatchSchema)
	.handler(async ({ input, context }) => {
		const db = getDb();

		return await db.transaction(async (tx) => {
			const [queue] = await tx
				.select()
				.from(productMatchQueue)
				.where(
					and(
						eq(productMatchQueue.id, input.queueId),
						eq(productMatchQueue.version, input.version),
					),
				);

			if (!queue || queue.status !== "pending") {
				throw new Error("Queue item was modified or already processed");
			}

			const userId = (context as { user: { id: string } }).user?.id;

			if (input.productId) {
				// Scoped rejection - reject specific candidate
				await tx.insert(productMatchRejections).values({
					retailerItemId: queue.retailerItemId,
					rejectedProductId: input.productId,
					reason: input.reason ?? "rejected",
					rejectedBy: userId,
				});

				// Check if there are still candidates left
				const remaining = await tx
					.select({ count: sql<number>`count(*)` })
					.from(productMatchCandidates)
					.where(eq(productMatchCandidates.retailerItemId, queue.retailerItemId));

				// If no candidates left, mark as rejected
				if (remaining[0]?.count === 0) {
					await tx
						.update(productMatchQueue)
						.set({
							status: "rejected",
							decision: "no_match",
							reviewedBy: userId,
							reviewedAt: new Date(),
							reviewNotes: input.reason,
							version: (queue.version ?? 1) + 1,
						})
						.where(eq(productMatchQueue.id, input.queueId));
				}
			} else {
				// Full rejection - no match exists
				await tx
					.update(productMatchQueue)
					.set({
						status: "rejected",
						decision: "no_match",
						reviewedBy: userId,
						reviewedAt: new Date(),
						reviewNotes: input.reason,
						version: (queue.version ?? 1) + 1,
					})
					.where(eq(productMatchQueue.id, input.queueId));
			}

			// Audit
			await tx.insert(productMatchAudit).values({
				queueId: input.queueId,
				action: input.productId ? "rejected_candidate" : "rejected",
				userId,
				newState: JSON.stringify({
					reason: input.reason,
					productId: input.productId,
				}),
			});

			return { success: true };
		});
	});

// Bulk approve matches using set-based query
export const bulkApprove = superadminProcedure
	.input(bulkApproveSchema)
	.handler(async ({ input, context }) => {
		const db = getDb();
		const userId = (context as { user: { id: string } }).user?.id;

		// Set-based bulk operation
		const bulkResult = await db.execute(
			sql`
				WITH best_candidates AS (
					SELECT DISTINCT ON (q.retailer_item_id)
						q.id as queue_id,
						q.retailer_item_id,
						c.candidate_product_id,
						q.version as original_version
					FROM product_match_queue q
					JOIN product_match_candidates c ON c.retailer_item_id = q.retailer_item_id
					WHERE q.id = ANY(${input.queueIds}::text[])
						AND q.status = 'pending'
						AND c.rank = 1
					ORDER BY q.retailer_item_id, c.rank
				),
				insert_links AS (
					INSERT INTO product_links (id, product_id, retailer_item_id, confidence, created_at)
					SELECT gen_random_text(), candidate_product_id, retailer_item_id, 'bulk_approved', now()
					FROM best_candidates
					ON CONFLICT (retailer_item_id) DO NOTHING
					RETURNING retailer_item_id
				),
				update_queue AS (
					UPDATE product_match_queue q
					SET status = 'approved',
						decision = 'linked',
						linked_product_id = bc.candidate_product_id,
						reviewed_by = ${userId},
						reviewed_at = now(),
						version = version + 1
					FROM best_candidates bc
					WHERE q.id = bc.queue_id
					RETURNING q.id
				)
				SELECT COUNT(*) as approved FROM update_queue
			`,
		);

		const rows: any[] = (bulkResult as any).rows ?? [];
		return { approved: rows[0]?.approved ?? 0 };
	});

// Resolve suspicious barcode items by linking to correct product
export const resolveSuspicious = superadminProcedure
	.input(resolveSuspiciousSchema)
	.handler(async ({ input, context }) => {
		const db = getDb();

		return await db.transaction(async (tx) => {
			const [queue] = await tx
				.select()
				.from(productMatchQueue)
				.where(
					and(
						eq(productMatchQueue.id, input.queueId),
						eq(productMatchQueue.version, input.version),
					),
				);

			if (!queue || queue.status !== "pending") {
				throw new Error("Queue item was modified or already processed");
			}

			const userId = (context as { user: { id: string } }).user?.id;

			// Create link
			await tx.insert(productLinks).values({
				productId: input.productId,
				retailerItemId: queue.retailerItemId,
				confidence: "manual",
			});

			// Update queue
			await tx
				.update(productMatchQueue)
				.set({
					status: "approved",
					decision: "linked",
					linkedProductId: input.productId,
					reviewedBy: userId,
					reviewedAt: new Date(),
					reviewNotes: input.notes,
					version: (queue.version ?? 1) + 1,
				})
				.where(eq(productMatchQueue.id, input.queueId));

			// Audit
			await tx.insert(productMatchAudit).values({
				queueId: input.queueId,
				action: "resolved_suspicious",
				userId,
				newState: JSON.stringify({
					status: "approved",
					productId: input.productId,
					notes: input.notes,
				}),
			});

			return { success: true };
		});
	});

// Search products for manual linking
export const searchProducts = superadminProcedure
	.input(
		z.object({
			query: z.string().min(3),
			limit: z.number().default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		const searchResult = await db.execute(
			sql`
				SELECT
					p.id,
					p.name,
					p.brand,
					p.category,
					p.image_url,
					similarity(lower(p.name), lower(${input.query})) as sim_score
				FROM products p
				WHERE similarity(lower(p.name), lower(${input.query})) > 0.1
				ORDER BY sim_score DESC, p.name
				LIMIT ${input.limit}
			`,
		);

		const rows: any[] = (searchResult as any).rows ?? [];
		return rows;
	});

// Get matching statistics
export const getStats = superadminProcedure.handler(async () => {
	const db = getDb();

	// Get queue statistics
	const queueResult = await db.execute(
		sql`
			SELECT
				COUNT(*) FILTER (WHERE status = 'pending') as pending,
				COUNT(*) FILTER (WHERE status = 'approved') as approved,
				COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
				COUNT(*) FILTER (WHERE status = 'skipped') as skipped
			FROM product_match_queue
		`,
	);

	// Get candidate statistics
	const candidateResult = await db.execute(
		sql`
			SELECT
				COUNT(*) as total,
				COUNT(*) FILTER (WHERE match_type = 'ai') as ai,
				COUNT(*) FILTER (WHERE match_type = 'barcode') as barcode,
				COUNT(*) FILTER (WHERE match_type = 'trgm') as trgm
			FROM product_match_candidates
		`,
	);

	// Get link statistics
	const linkResult = await db.execute(
		sql`
			SELECT
				COUNT(*) as total,
				COUNT(*) FILTER (WHERE confidence = 'barcode') as barcode,
				COUNT(*) FILTER (WHERE confidence = 'ai') as ai,
				COUNT(*) FILTER (WHERE confidence = 'manual') as manual
			FROM product_links
		`,
	);

	return {
		queue: (queueResult as any).rows?.[0],
		candidates: (candidateResult as any).rows?.[0],
		links: (linkResult as any).rows?.[0],
	};
});
