import { os } from "@orpc/server";
import { and, count, desc, eq, like, or, sql } from "drizzle-orm";
import * as z from "zod";
import { storeEnrichmentTasks, stores } from "@/db/schema";
import { getDb } from "@/utils/bindings";

// ============================================================================
// Core Store Operations
// ============================================================================

export const listStores = os
	.input(
		z.object({
			chainSlug: z.string().optional(),
			status: z.enum(["active", "pending"]).optional(),
			isVirtual: z.boolean().optional(),
			search: z.string().optional(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const offset = (input.page - 1) * input.pageSize;

		const conditions = [];

		if (input.chainSlug) {
			conditions.push(eq(stores.chainSlug, input.chainSlug));
		}
		if (input.status) {
			conditions.push(eq(stores.status, input.status));
		}
		if (input.isVirtual !== undefined) {
			conditions.push(eq(stores.isVirtual, input.isVirtual));
		}
		if (input.search) {
			conditions.push(
				or(
					like(stores.name, `%${input.search}%`),
					like(stores.address, `%${input.search}%`),
					like(stores.city, `%${input.search}%`),
				),
			);
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const [storesList, totalResult] = await Promise.all([
			db
				.select()
				.from(stores)
				.where(whereClause)
				.orderBy(desc(stores.createdAt))
				.limit(input.pageSize)
				.offset(offset),
			db.select({ count: count() }).from(stores).where(whereClause),
		]);

		return {
			stores: storesList,
			total: totalResult[0]?.count ?? 0,
			page: input.page,
			pageSize: input.pageSize,
			totalPages: Math.ceil((totalResult[0]?.count ?? 0) / input.pageSize),
		};
	});

export const getStore = os
	.input(z.object({ storeId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const result = await db
			.select()
			.from(stores)
			.where(eq(stores.id, input.storeId));
		if (result.length === 0) {
			throw new Error("Store not found");
		}
		return result[0];
	});

export const updateStore = os
	.input(
		z.object({
			storeId: z.string(),
			name: z.string().optional(),
			address: z.string().optional(),
			city: z.string().optional(),
			lat: z.string().optional(),
			lng: z.string().optional(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		const updateData: Partial<typeof stores.$inferInsert> = {
			updatedAt: new Date(),
		};

		if (input.name !== undefined) updateData.name = input.name;
		if (input.address !== undefined) updateData.address = input.address;
		if (input.city !== undefined) updateData.city = input.city;
		if (input.lat !== undefined) updateData.latitude = input.lat;
		if (input.lng !== undefined) updateData.longitude = input.lng;

		await db.update(stores).set(updateData).where(eq(stores.id, input.storeId));

		return { success: true };
	});

export const approveStore = os
	.input(z.object({ storeId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Verify store exists and is pending
		const existing = await db
			.select()
			.from(stores)
			.where(eq(stores.id, input.storeId));
		if (existing.length === 0) {
			throw new Error("Store not found");
		}
		if (existing[0].status !== "pending") {
			throw new Error("Store is not in pending status");
		}

		await db
			.update(stores)
			.set({ status: "active", updatedAt: new Date() })
			.where(eq(stores.id, input.storeId));

		return { success: true };
	});

export const rejectStore = os
	.input(z.object({ storeId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Verify store exists
		const existing = await db
			.select()
			.from(stores)
			.where(eq(stores.id, input.storeId));
		if (existing.length === 0) {
			throw new Error("Store not found");
		}

		await db.delete(stores).where(eq(stores.id, input.storeId));

		return { success: true };
	});

export const mergeStores = os
	.input(
		z.object({
			sourceStoreId: z.string(),
			targetStoreId: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		if (input.sourceStoreId === input.targetStoreId) {
			throw new Error("Cannot merge a store into itself");
		}

		// Verify both stores exist
		const [sourceStore, targetStore] = await Promise.all([
			db.select().from(stores).where(eq(stores.id, input.sourceStoreId)),
			db.select().from(stores).where(eq(stores.id, input.targetStoreId)),
		]);

		if (sourceStore.length === 0) {
			throw new Error("Source store not found");
		}
		if (targetStore.length === 0) {
			throw new Error("Target store not found");
		}

		// Update any stores that have sourceStore as their priceSourceStoreId
		await db
			.update(stores)
			.set({ priceSourceStoreId: input.targetStoreId, updatedAt: new Date() })
			.where(eq(stores.priceSourceStoreId, input.sourceStoreId));

		// Delete the source store
		await db.delete(stores).where(eq(stores.id, input.sourceStoreId));

		return { success: true };
	});

export const linkPriceSource = os
	.input(
		z.object({
			storeId: z.string(),
			priceSourceStoreId: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		if (input.storeId === input.priceSourceStoreId) {
			throw new Error("Cannot link a store to itself");
		}

		// Verify both stores exist
		const [store, priceSourceStore] = await Promise.all([
			db.select().from(stores).where(eq(stores.id, input.storeId)),
			db.select().from(stores).where(eq(stores.id, input.priceSourceStoreId)),
		]);

		if (store.length === 0) {
			throw new Error("Store not found");
		}
		if (priceSourceStore.length === 0) {
			throw new Error("Price source store not found");
		}

		await db
			.update(stores)
			.set({
				priceSourceStoreId: input.priceSourceStoreId,
				updatedAt: new Date(),
			})
			.where(eq(stores.id, input.storeId));

		return { success: true };
	});

export const unlinkPriceSource = os
	.input(z.object({ storeId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Verify store exists
		const existing = await db
			.select()
			.from(stores)
			.where(eq(stores.id, input.storeId));
		if (existing.length === 0) {
			throw new Error("Store not found");
		}

		await db
			.update(stores)
			.set({ priceSourceStoreId: null, updatedAt: new Date() })
			.where(eq(stores.id, input.storeId));

		return { success: true };
	});

export const getPendingStores = os
	.input(
		z.object({
			chainSlug: z.string().optional(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		const conditions = [eq(stores.status, "pending")];

		if (input.chainSlug) {
			conditions.push(eq(stores.chainSlug, input.chainSlug));
		}

		const pendingStores = await db
			.select()
			.from(stores)
			.where(and(...conditions))
			.orderBy(desc(stores.createdAt));

		return { stores: pendingStores };
	});

export const getLinkedPhysicalStores = os
	.input(z.object({ virtualStoreId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Verify the virtual store exists and is virtual
		const virtualStore = await db
			.select()
			.from(stores)
			.where(eq(stores.id, input.virtualStoreId));
		if (virtualStore.length === 0) {
			throw new Error("Virtual store not found");
		}
		if (!virtualStore[0].isVirtual) {
			throw new Error("Store is not a virtual store");
		}

		// Find all physical stores linked to this virtual store
		const linkedStores = await db
			.select()
			.from(stores)
			.where(eq(stores.priceSourceStoreId, input.virtualStoreId))
			.orderBy(desc(stores.createdAt));

		return { stores: linkedStores };
	});

// ============================================================================
// Enhanced List Endpoints for Admin UI
// ============================================================================

export const listVirtualStores = os
	.input(
		z.object({
			chainSlug: z.string().optional(),
			status: z.enum(["active", "pending"]).optional(),
			search: z.string().optional(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		const conditions = [eq(stores.isVirtual, true)];

		if (input.chainSlug) {
			conditions.push(eq(stores.chainSlug, input.chainSlug));
		}
		if (input.status) {
			conditions.push(eq(stores.status, input.status));
		}
		if (input.search) {
			conditions.push(
				or(
					like(stores.name, `%${input.search}%`),
					like(stores.city, `%${input.search}%`),
				) ?? sql`1=1`,
			);
		}

		// Get virtual stores
		const virtualStores = await db
			.select()
			.from(stores)
			.where(and(...conditions))
			.orderBy(desc(stores.createdAt));

		// Get linked counts for each virtual store
		const storesWithCounts = await Promise.all(
			virtualStores.map(async (store) => {
				const [countResult] = await db
					.select({ count: count() })
					.from(stores)
					.where(eq(stores.priceSourceStoreId, store.id));
				return {
					...store,
					linkedPhysicalCount: countResult?.count ?? 0,
				};
			}),
		);

		return { stores: storesWithCounts };
	});

export const listPhysicalStores = os
	.input(
		z.object({
			chainSlug: z.string().optional(),
			status: z.enum(["active", "pending"]).optional(),
			search: z.string().optional(),
			linkedStatus: z.enum(["linked", "unlinked", "all"]).optional(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const offset = (input.page - 1) * input.pageSize;

		const conditions = [eq(stores.isVirtual, false)];

		if (input.chainSlug) {
			conditions.push(eq(stores.chainSlug, input.chainSlug));
		}
		if (input.status) {
			conditions.push(eq(stores.status, input.status));
		}
		if (input.linkedStatus === "linked") {
			conditions.push(sql`${stores.priceSourceStoreId} IS NOT NULL`);
		} else if (input.linkedStatus === "unlinked") {
			conditions.push(sql`${stores.priceSourceStoreId} IS NULL`);
		}
		if (input.search) {
			conditions.push(
				or(
					like(stores.name, `%${input.search}%`),
					like(stores.address, `%${input.search}%`),
					like(stores.city, `%${input.search}%`),
				) ?? sql`1=1`,
			);
		}

		const whereClause = and(...conditions);

		// Alias for the price source store
		const priceSourceStore = db
			.select({
				id: stores.id,
				name: stores.name,
			})
			.from(stores)
			.as("price_source");

		const [physicalStores, totalResult] = await Promise.all([
			db
				.select({
					id: stores.id,
					chainSlug: stores.chainSlug,
					name: stores.name,
					address: stores.address,
					city: stores.city,
					postalCode: stores.postalCode,
					latitude: stores.latitude,
					longitude: stores.longitude,
					isVirtual: stores.isVirtual,
					priceSourceStoreId: stores.priceSourceStoreId,
					status: stores.status,
					createdAt: stores.createdAt,
					updatedAt: stores.updatedAt,
					priceSourceName: priceSourceStore.name,
				})
				.from(stores)
				.leftJoin(priceSourceStore, eq(stores.priceSourceStoreId, priceSourceStore.id))
				.where(whereClause)
				.orderBy(desc(stores.createdAt))
				.limit(input.pageSize)
				.offset(offset),
			db.select({ count: count() }).from(stores).where(whereClause),
		]);

		return {
			stores: physicalStores,
			total: totalResult[0]?.count ?? 0,
			page: input.page,
			pageSize: input.pageSize,
			totalPages: Math.ceil((totalResult[0]?.count ?? 0) / input.pageSize),
		};
	});

export const getVirtualStoresForLinking = os
	.input(z.object({ chainSlug: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		const virtualStores = await db
			.select({
				id: stores.id,
				name: stores.name,
			})
			.from(stores)
			.where(
				and(
					eq(stores.isVirtual, true),
					eq(stores.chainSlug, input.chainSlug),
					eq(stores.status, "active"),
				),
			)
			.orderBy(stores.name);

		return { stores: virtualStores };
	});

// ============================================================================
// Enrichment
// ============================================================================

export const triggerEnrichment = os
	.input(
		z.object({
			storeId: z.string(),
			type: z.enum(["geocode", "verify_address", "ai_categorize"]),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		// Verify store exists
		const store = await db
			.select()
			.from(stores)
			.where(eq(stores.id, input.storeId));
		if (store.length === 0) {
			throw new Error("Store not found");
		}

		// Create enrichment task
		const [task] = await db
			.insert(storeEnrichmentTasks)
			.values({
				storeId: input.storeId,
				type: input.type,
				status: "pending",
				inputData: JSON.stringify({
					name: store[0].name,
					address: store[0].address,
					city: store[0].city,
					postalCode: store[0].postalCode,
					latitude: store[0].latitude,
					longitude: store[0].longitude,
				}),
			})
			.returning();

		return { task };
	});

export const getEnrichmentTasks = os
	.input(z.object({ storeId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();

		// Verify store exists
		const store = await db
			.select()
			.from(stores)
			.where(eq(stores.id, input.storeId));
		if (store.length === 0) {
			throw new Error("Store not found");
		}

		const tasks = await db
			.select()
			.from(storeEnrichmentTasks)
			.where(eq(storeEnrichmentTasks.storeId, input.storeId))
			.orderBy(desc(storeEnrichmentTasks.createdAt));

		return { tasks };
	});

export const verifyEnrichment = os
	.input(
		z.object({
			taskId: z.string(),
			accepted: z.boolean(),
			corrections: z.record(z.string(), z.unknown()).optional(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		// Verify task exists
		const task = await db
			.select()
			.from(storeEnrichmentTasks)
			.where(eq(storeEnrichmentTasks.id, input.taskId));
		if (task.length === 0) {
			throw new Error("Enrichment task not found");
		}

		if (task[0].status !== "completed") {
			throw new Error("Can only verify completed enrichment tasks");
		}

		// Update the task with verification info
		await db
			.update(storeEnrichmentTasks)
			.set({
				verifiedAt: new Date(),
				updatedAt: new Date(),
				// If corrections provided, update outputData with corrections
				...(input.corrections && {
					outputData: JSON.stringify({
						...JSON.parse(task[0].outputData || "{}"),
						corrections: input.corrections,
						accepted: input.accepted,
					}),
				}),
			})
			.where(eq(storeEnrichmentTasks.id, input.taskId));

		// If accepted, apply the enrichment results to the store
		if (input.accepted) {
			const outputData =
				input.corrections || JSON.parse(task[0].outputData || "{}");
			const storeUpdate: Partial<typeof stores.$inferInsert> = {
				updatedAt: new Date(),
			};

			// Apply relevant fields from output data
			if (outputData.latitude)
				storeUpdate.latitude = String(outputData.latitude);
			if (outputData.longitude)
				storeUpdate.longitude = String(outputData.longitude);
			if (outputData.address) storeUpdate.address = outputData.address;
			if (outputData.city) storeUpdate.city = outputData.city;
			if (outputData.postalCode) storeUpdate.postalCode = outputData.postalCode;

			if (Object.keys(storeUpdate).length > 1) {
				await db
					.update(stores)
					.set(storeUpdate)
					.where(eq(stores.id, task[0].storeId));
			}
		}

		return { success: true };
	});
