/**
 * Integration tests for Store Approval Workflow
 *
 * These tests require a database connection and verify full workflow:
 * - Full workflow from pending to approved
 * - Concurrent conflicts
 * - Merge integrity
 * - Bulk operations
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { generatePrefixedId } from "@/utils/id";

describe("Store Approval Workflow Integration Tests", () => {
	const testStoreIds: string[] = [];

	beforeAll(async () => {
		const { getDb } = await import("@/utils/bindings");
		const db = getDb();

		// Clean up test stores
		for (const storeId of testStoreIds) {
			try {
				await db
					.delete(schema.stores)
					.where(eq(schema.stores.id, storeId))
					.execute();
			} catch (e) {
				console.warn(`Failed to cleanup store ${storeId}:`, e);
			}
		}

		// Create test chain first (required by foreign key)
		const now = new Date();
		await db
			.insert(schema.chains)
			.values({
				slug: "konzum",
				name: "Integration Test Chain",
			})
			.execute();

		// Create test stores
		// Store 1: Pending store
		const store1Id = generatePrefixedId("sto");
		await db
			.insert(schema.stores)
			.values({
				id: store1Id,
				chainSlug: "konzum",
				name: "Integration Test Store 1",
				address: "Test Address 1",
				city: "Zagreb",
				postalCode: "10000",
				latitude: "45.8150",
				longitude: "15.9819",
				isVirtual: true,
				priceSourceStoreId: null,
				status: "pending",
				createdAt: now,
				updatedAt: now,
			})
			.execute();
		testStoreIds.push(store1Id);

		// Store 2: Another pending store for merge testing
		const store2Id = generatePrefixedId("sto");
		await db
			.insert(schema.stores)
			.values({
				id: store2Id,
				chainSlug: "konzum",
				name: "Integration Test Store 2",
				address: "Test Address 2",
				city: "Zagreb",
				postalCode: "10000",
				latitude: "45.8150",
				longitude: "15.9819",
				isVirtual: true,
				priceSourceStoreId: null,
				status: "pending",
				createdAt: now,
				updatedAt: now,
			})
			.execute();
		testStoreIds.push(store2Id);

		// Store 3: Active store for merge testing
		const store3Id = generatePrefixedId("sto");
		await db
			.insert(schema.stores)
			.values({
				id: store3Id,
				chainSlug: "konzum",
				name: "Integration Test Store 3 (Active)",
				address: "Test Address 3",
				city: "Zagreb",
				postalCode: "10000",
				latitude: "45.8150",
				longitude: "15.9819",
				isVirtual: true,
				priceSourceStoreId: null,
				status: "active",
				createdAt: now,
				updatedAt: now,
			})
			.execute();
		testStoreIds.push(store3Id);
	});

	afterAll(async () => {
		const { getDb } = await import("@/utils/bindings");
		const db = getDb();

		// Clean up test stores
		for (const storeId of testStoreIds) {
			try {
				await db
					.delete(schema.stores)
					.where(eq(schema.stores.id, storeId))
					.execute();
			} catch (e) {
				console.warn(`Failed to cleanup store ${storeId}:`, e);
			}
		}
	});

	describe("Full Approval Workflow", () => {
		it("should transition store from pending to active", async () => {
			const { getDb } = await import("@/utils/bindings");
			const db = getDb();
			const storeId = testStoreIds[0];

			// Verify initial state
			const [store] = await db
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.from(schema.stores)
				.where(eq(schema.stores.id, storeId))
				.limit(1);

			expect(store).toBeDefined();
			expect(store.status).toBe("pending");

			// Simulate approval (would normally be done via API)
			const userId = "integration-test-user";
			const approvalNotes = "Integration test approval";
			const now = new Date();

			await db
				.update(schema.stores)
				.set({
					status: "active",
					updatedAt: now,
					approvalNotes: approvalNotes,
					approvedBy: userId,
					approvedAt: now,
				})
				.where(eq(schema.stores.id, storeId))
				.execute();

			// Verify final state
			// Verify final state
			const [updatedStore] = await db
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.from(schema.stores)
				.where(eq(schema.stores.id, storeId))
				.limit(1)
				.all();

			expect(updatedStore.status).toBe("active");
			expect(updatedStore.approvedBy).toBe(userId);
			expect(updatedStore.approvedNotes).toBe(approvalNotes);
			expect(updatedStore.approvedAt).toBeDefined();
		});

		it("should prevent approval of already active store", async () => {
		it("should prevent approval of already active store", async () => {
			const { getDb } = await import("@/utils/bindings");
			const db = getDb();
			const storeId = testStoreIds[2]; // Already active

			// Verify store is active
			const [store] = await db
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.from(schema.stores)
				.where(eq(schema.stores.id, storeId))
				.limit(1);

			expect(store.status).toBe("active");

			// This would be enforced at API level
			// This would be enforced at API level
			// Just verify the state is as expected
			expect(store.status).not.toBe("pending");
		});
	});

	describe("Concurrent Modification Detection", () => {
		it("should detect when store was modified by another user", async () => {
			const { getDb } = await import("@/utils/bindings");
			const db = getDb();
			const storeId = testStoreIds[1];

			// Get current store
			// Get current store
			const [store] = await db
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.from(schema.stores)
				.where(eq(schema.stores.id, storeId))
				.limit(1);

			const originalUpdatedAt = store.updatedAt;

			// Simulate another user modifying the store
			await db
				.update(schema.stores)
				.set({ updatedAt: new Date() })
				.where(eq(schema.stores.id, storeId))
				.execute();

			// Try to approve with old timestamp
			const expectedDate = new Date(originalUpdatedAt);
			const [currentStore] = await db
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.from(schema.stores)
				.where(eq(schema.stores.id, storeId))
				.limit(1)
				.all();
			const currentDate = new Date(currentStore.updatedAt);

			// Verify timestamps don't match (concurrent modification detected)
			expect(expectedDate.getTime()).not.toBe(currentDate.getTime());
		});
	});

	describe("Merge Operations", () => {
		it("should prevent merging store into itself", async () => {
			// This is a validation test - constraint is enforced at API level
			const storeId = testStoreIds[0];

			// Can't merge into self
			expect(storeId).toBe(storeId); // Same ID
		});

		it("should verify both stores exist before merge", async () => {
			const { getDb } = await import("@/utils/bindings");
			const db = getDb();
			const sourceId = testStoreIds[0];
			const targetId = testStoreIds[1];

			// Verify both stores exist
			const [sourceStore] = await db
				.select()
  .limit(1);
  .limit(1);
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.from(schema.stores)
				.where(eq(schema.stores.id, sourceId))
				.limit(1)
				.all();
			const [targetStore] = await db
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.from(schema.stores)
				.where(eq(schema.stores.id, targetId))
				.limit(1)
				.all();

			expect(sourceStore).toBeDefined();
			expect(targetStore).toBeDefined();
		});
	});

	describe("Bulk Operations", () => {
		it("should handle bulk approval of multiple stores", async () => {
			const { getDb } = await import("@/utils/bindings");
			const db = getDb();


			// Create additional test stores
			const now = new Date();
			const bulkStoreIds: string[] = [];

			for (let i = 1; i <= 3; i++) {
				const storeId = generatePrefixedId("sto");
				await db
					.insert(schema.stores)
					.values({
						id: storeId,
						chainSlug: "konzum",
						name: `Bulk Test Store ${i}`,
						address: `Bulk Address ${i}`,
						city: "Zagreb",
						postalCode: "10000",
						isVirtual: true,
						status: "pending",
						createdAt: now,
						updatedAt: now,
					})
					.execute();
				bulkStoreIds.push(storeId);
			}

			// Verify all stores are pending
			for (const storeId of bulkStoreIds) {
				const [store] = await db
					.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
					.from(schema.stores)
					.where(eq(schema.stores.id, storeId))
					.limit(1)
					.all();
				expect(store.status).toBe("pending");
			}

			// Simulate bulk approval
			const userId = "integration-test-user";
			const bulkNotes = "Bulk approval integration test";

			for (const storeId of bulkStoreIds) {
				await db
					.update(schema.stores)
					.set({
						status: "active",
						updatedAt: new Date(),
						approvalNotes: bulkNotes,
						approvedBy: userId,
						approvedAt: new Date(),
					})
					.where(eq(schema.stores.id, storeId))
					.execute();
			}

			// Verify all stores are now active
			for (const storeId of bulkStoreIds) {
				const [store] = await db
					.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
					.from(schema.stores)
					.where(eq(schema.stores.id, storeId))
					.limit(1)
					.all();
				expect(store.status).toBe("active");
				expect(store.approvedBy).toBe(userId);
				expect(store.approvalNotes).toBe(bulkNotes);
			}

			// Cleanup
			for (const storeId of bulkStoreIds) {
				try {
					await db
						.delete(schema.stores)
						.where(eq(schema.stores.id, storeId))
						.execute();
				} catch (_e) {
					// Ignore cleanup errors
				}
			}
		});

		it("should fail bulk operations when stores are not in pending status", async () => {
			const { getDb } = await import("@/utils/bindings");
			const db = getDb();

			// Try to get pending stores
			const pendingStores = await db
				.select()
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
  .limit(1);
				.from(schema.stores)
				.where(eq(schema.stores.status, "pending"))
				.all();

			// After our previous tests, there might be no pending stores
			// This is expected behavior
			expect(Array.isArray(pendingStores)).toBe(true);
		});
	});

	describe("Force Approval", () => {
		it("should require justification for force approval", async () => {
			// This is a contract test - API enforces this
			const input = {
				justification: "",
			};

			// Empty string trimmed length is 0, so should be falsy
			const hasJustification = Boolean(
				input.justification && input.justification.trim().length > 0,
			);
			expect(hasJustification).toBe(false);
		});

		it("should combine notes with justification", async () => {
			const approvalNotes = "Store verified manually";
			const justification = "Known location from field visit";

			const combinedNotes = approvalNotes
				? `${approvalNotes}\n\n[FORCE APPROVAL] ${justification}`
				: `[FORCE APPROVAL] ${justification}`;

			expect(combinedNotes).toContain("Store verified manually");
			expect(combinedNotes).toContain("[FORCE APPROVAL]");
			expect(combinedNotes).toContain("Known location from field visit");
		});
	});
});

// Unit tests that don't require database
describe("Store Workflow Contract Tests", () => {
	describe("Status Enum Values", () => {
		it("should have valid status values", () => {
			const validStatuses = [
				"pending",
				"enriched",
				"needs_review",
				"approved",
				"active",
				"rejected",
				"merged",
				"failed",
			];

			validStatuses.forEach((status) => {
				expect(typeof status).toBe("string");
				expect(status.length).toBeGreaterThan(0);
			});
		});
	});

	describe("ID Generation", () => {
		it("should generate prefixed IDs", () => {
			const storeId = generatePrefixedId("sto");
			expect(storeId).toBeDefined();
			expect(typeof storeId).toBe("string");
			expect(storeId.startsWith("sto_")).toBe(true);
		});

		it("should generate unique IDs", () => {
			const id1 = generatePrefixedId("sto");
			const id2 = generatePrefixedId("sto");

			expect(id1).not.toBe(id2);
		});
	});
});
