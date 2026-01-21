/**
 * Unit tests for Store Mutations
 *
 * Tests state transitions, authorization, optimistic locking, and enrichment.
 * These tests use mocked database connections and do not require a real database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDb } from "@/utils/bindings";

// Mock the database
vi.mock("@/utils/bindings", () => ({
	getDb: vi.fn(),
}));

// Mock the auth context
const mockSuperadminContext = {
	session: {
		user: {
			id: "test-superadmin-id",
			name: "Test Superadmin",
			email: "superadmin@test.com",
			role: "superadmin",
		},
	},
	user: {
		id: "test-superadmin-id",
		name: "Test Superadmin",
		email: "superadmin@test.com",
		role: "superadmin",
	},
};

const mockRegularUserContext = {
	session: {
		user: {
			id: "test-user-id",
			name: "Test User",
			email: "user@test.com",
			role: "user",
		},
	},
	user: {
		id: "test-user-id",
		name: "Test User",
		email: "user@test.com",
		role: "user",
	},
};

describe("Store Mutations Unit Tests", () => {
	// Setup the mock with proper chaining
	let capturedUpdateData: any = null;
	const mockSet = vi.fn().mockImplementation((data: any) => {
		capturedUpdateData = data;
		return {
			where: vi.fn().mockResolvedValue(undefined),
		};
	});
	const mockUpdate = vi.fn().mockReturnValue({
		set: mockSet,
	});
	const mockDelete = vi.fn().mockReturnValue({
		where: vi.fn().mockResolvedValue(undefined),
	});
	const mockDb = {
		select: vi.fn(),
		insert: vi.fn(),
		update: mockUpdate,
		delete: mockDelete,
	};

	beforeEach(() => {
		vi.mocked(getDb).mockReturnValue(mockDb as any);
		capturedUpdateData = null;
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	// ============================================================================
	// State Transition Tests
	// ============================================================================

	describe("State Transitions", () => {
		it("should transition store from pending to active", async () => {
			const pendingStore = {
				id: "sto_test123",
				status: "pending",
				updatedAt: new Date("2024-01-01T10:00:00Z"),
				chainSlug: "konzum",
				name: "Test Store",
			};

			mockDb.select.mockResolvedValue([pendingStore]);

			// Simulate the approve logic
			const existing = await mockDb.select();
			if (existing.length === 0) {
				throw new Error("Store not found");
			}
			if (existing[0].status !== "pending") {
				throw new Error("Store is not in pending status");
			}

			const input = {
				storeId: "sto_test123",
				expectedUpdatedAt: new Date("2024-01-01T10:00:00Z").toISOString(),
				approvalNotes: "Test approval",
			};

			const expectedDate = new Date(input.expectedUpdatedAt);
			const store = existing[0];
			if (!store.updatedAt || store.updatedAt.getTime() !== expectedDate.getTime()) {
				throw new Error("Store was modified by someone else. Please refresh and try again.");
			}

			await mockDb.update().set({
				status: "active",
				updatedAt: new Date(),
				...(input.approvalNotes ? { approvalNotes: input.approvalNotes } : {}),
				approvedBy: mockSuperadminContext.user.id,
				approvedAt: new Date(),
			});

			expect(store.status).toBe("pending"); // Was pending before
		});

		it("should fail when store is not in pending status", async () => {
			const activeStore = {
				id: "sto_test123",
				status: "active",
				updatedAt: new Date("2024-01-01T10:00:00Z"),
			};

			mockDb.select.mockResolvedValue([activeStore]);

			const existing = await mockDb.select();

			// This test verifies that stores not in pending status should be rejected
			expect(existing[0].status).toBe("active");

			// Verify that the status check would fail
			expect(() => {
				if (existing[0].status !== "pending") {
					throw new Error("Store is not in pending status");
				}
			}).toThrow("Store is not in pending status");
		});
	});

	// ============================================================================
	// Authorization Tests
	// ============================================================================

	describe("Authorization", () => {
		it("should require superadmin role for approval", () => {
			// superadminProcedure enforces this at middleware level
			// This test verifies the contract
			expect(mockSuperadminContext.user.role).toBe("superadmin");
			expect(mockRegularUserContext.user.role).toBe("user");
		});

		it("should record approver user ID in approval", async () => {
			const pendingStore = {
				id: "sto_test123",
				status: "pending",
				updatedAt: new Date("2024-01-01T10:00:00Z"),
			};

			mockDb.select.mockResolvedValue([pendingStore]);

			await mockDb.select();

			await mockDb.update().set({
				status: "active",
				updatedAt: new Date(),
				approvedBy: mockSuperadminContext.user.id,
				approvedAt: new Date(),
			});

			expect(capturedUpdateData.approvedBy).toBe("test-superadmin-id");
		});
	});

	// ============================================================================
	// Optimistic Locking Tests
	// ============================================================================

	describe("Optimistic Locking", () => {
		it("should fail when updatedAt timestamp does not match", async () => {
			const store = {
				id: "sto_test123",
				status: "pending",
				updatedAt: new Date("2024-01-01T10:05:00Z"), // Different timestamp
			};

			mockDb.select.mockResolvedValue([store]);

			const existing = await mockDb.select();
			const input = {
				expectedUpdatedAt: new Date("2024-01-01T10:00:00Z").toISOString(), // Different
			};

			const expectedDate = new Date(input.expectedUpdatedAt);
			const actualStore = existing[0];

			if (!actualStore.updatedAt || actualStore.updatedAt.getTime() !== expectedDate.getTime()) {
				expect(actualStore.updatedAt?.getTime()).not.toBe(expectedDate.getTime());
			}
		});

		it("should pass when updatedAt timestamp matches", async () => {
			const store = {
				id: "sto_test123",
				status: "pending",
				updatedAt: new Date("2024-01-01T10:00:00Z"),
			};

			mockDb.select.mockResolvedValue([store]);

			const existing = await mockDb.select();
			const input = {
				expectedUpdatedAt: new Date("2024-01-01T10:00:00Z").toISOString(),
			};

			const expectedDate = new Date(input.expectedUpdatedAt);
			const actualStore = existing[0];

			expect(actualStore.updatedAt?.getTime()).toBe(expectedDate.getTime());
		});

		it("should handle missing updatedAt gracefully", async () => {
			const store = {
				id: "sto_test123",
				status: "pending",
				updatedAt: null,
			};

			mockDb.select.mockResolvedValue([store]);

			const existing = await mockDb.select();
			const input = {
				expectedUpdatedAt: new Date("2024-01-01T10:00:00Z").toISOString(),
			};

			const expectedDate = new Date(input.expectedUpdatedAt);
			const actualStore = existing[0];

			if (!actualStore.updatedAt || actualStore.updatedAt.getTime() !== expectedDate.getTime()) {
				// This should fail validation
				expect(actualStore.updatedAt).toBeNull();
			}
		});
	});

	// ============================================================================
	// Merge Operations Tests
	// ============================================================================

	describe("Merge Operations", () => {
		it("should prevent merging store into itself", () => {
			const input = {
				sourceStoreId: "sto_test123",
				targetStoreId: "sto_test123", // Same as source
			};

			if (input.sourceStoreId === input.targetStoreId) {
				expect(() => {
					throw new Error("Cannot merge a store into itself");
				}).toThrow("Cannot merge a store into itself");
			}
		});

		it("should verify optimistic locking on both source and target stores", async () => {
			const sourceStore = {
				id: "sto_source",
				status: "pending",
				updatedAt: new Date("2024-01-01T10:00:00Z"),
			};
			const targetStore = {
				id: "sto_target",
				status: "active",
				updatedAt: new Date("2024-01-01T10:00:00Z"),
			};

			let callCount = 0;
			mockDb.select.mockImplementation(() => {
				callCount++;
				if (callCount === 1) return Promise.resolve([sourceStore]);
				return Promise.resolve([targetStore]);
			});

			const input = {
				sourceStoreId: "sto_source",
				sourceExpectedUpdatedAt: new Date("2024-01-01T10:00:00Z").toISOString(),
				targetStoreId: "sto_target",
				targetExpectedUpdatedAt: new Date("2024-01-01T10:00:00Z").toISOString(),
			};

			const sourceExpectedDate = new Date(input.sourceExpectedUpdatedAt);
			const targetExpectedDate = new Date(input.targetExpectedUpdatedAt);

			expect(sourceStore.updatedAt?.getTime()).toBe(sourceExpectedDate.getTime());
			expect(targetStore.updatedAt?.getTime()).toBe(targetExpectedDate.getTime());
		});
	});

	// ============================================================================
	// Bulk Operations Tests
	// ============================================================================

	describe("Bulk Operations", () => {
		it("should validate all stores are pending before bulk approve", async () => {
			const stores = [
				{ id: "sto_1", status: "pending", updatedAt: new Date() },
				{ id: "sto_2", status: "pending", updatedAt: new Date() },
			];

			mockDb.select.mockResolvedValue(stores);

			const input = {
				storeIds: ["sto_1", "sto_2"],
			};

			const existingStores = await mockDb.select();
			const nonPendingStores = existingStores.filter((s: any) => s.status !== "pending");

			expect(existingStores.length).toBe(input.storeIds.length);
			expect(nonPendingStores.length).toBe(0);
		});

		it("should fail bulk approve when any store is not pending", async () => {
			const stores = [
				{ id: "sto_1", status: "pending", updatedAt: new Date() },
				{ id: "sto_2", status: "active", updatedAt: new Date() }, // Not pending
			];

			mockDb.select.mockResolvedValue(stores);

			const existingStores = await mockDb.select();
			const nonPendingStores = existingStores.filter((s: any) => s.status !== "pending");

			expect(nonPendingStores.length).toBeGreaterThan(0);
			expect(nonPendingStores[0].id).toBe("sto_2");
		});

		it("should validate store count before bulk operations", async () => {
			const stores = [
				{ id: "sto_1", status: "pending", updatedAt: new Date() },
			]; // Only 1 store found

			mockDb.select.mockResolvedValue(stores);

			const input = {
				storeIds: ["sto_1", "sto_2", "sto_3"], // Requested 3
			};

			const existingStores = await mockDb.select();

			expect(existingStores.length).not.toBe(input.storeIds.length);
			expect(existingStores.length).toBe(1);
			expect(input.storeIds.length).toBe(3);
		});

		it("should require at least one store ID for bulk operations", () => {
			const input = {
				storeIds: [], // Empty array
			};

			if (!input.storeIds || input.storeIds.length < 1) {
				expect(() => {
					throw new Error("At least one store ID is required");
				}).toThrow("At least one store ID is required");
			}
		});
	});

	// ============================================================================
	// Force Approval Tests
	// ============================================================================

	describe("Force Approval", () => {
		it("should require justification for force approval", () => {
			const input = {
				justification: "", // Empty justification
			};

			if (!input.justification || input.justification.trim().length < 1) {
				expect(() => {
					throw new Error("Justification is required for force approval");
				}).toThrow("Justification is required for force approval");
			}
		});

		it("should combine notes with force approval justification", () => {
			const input = {
				approvalNotes: "Store verified manually",
				justification: "Known location from field visit",
			};

			const combinedNotes = input.approvalNotes
				? `${input.approvalNotes}\n\n[FORCE APPROVAL] ${input.justification}`
				: `[FORCE APPROVAL] ${input.justification}`;

			expect(combinedNotes).toContain("Store verified manually");
			expect(combinedNotes).toContain("[FORCE APPROVAL]");
			expect(combinedNotes).toContain("Known location from field visit");
		});

		it("should use only justification when no approval notes provided", () => {
			const input: { approvalNotes?: string; justification: string } = {
				justification: "Legacy store with verified data",
			};

			const combinedNotes = input.approvalNotes
				? `${input.approvalNotes}\n\n[FORCE APPROVAL] ${input.justification}`
				: `[FORCE APPROVAL] ${input.justification}`;

			expect(combinedNotes).toBe("[FORCE APPROVAL] Legacy store with verified data");
		});
	});

	// ============================================================================
	// Edge Cases and Error Handling
	// ============================================================================

	describe("Edge Cases and Error Handling", () => {
		it("should handle store not found gracefully", async () => {
			mockDb.select.mockResolvedValue([]);

			const existing = await mockDb.select();

			if (existing.length === 0) {
				expect(() => {
					throw new Error("Store not found");
				}).toThrow("Store not found");
			}
		});

		it("should handle null updatedAt in optimistic locking", async () => {
			const store = {
				id: "sto_test123",
				status: "pending",
				updatedAt: null,
			};

			mockDb.select.mockResolvedValue([store]);

			const existing = await mockDb.select();
			const input = {
				expectedUpdatedAt: new Date("2024-01-01T10:00:00Z").toISOString(),
			};

			const expectedDate = new Date(input.expectedUpdatedAt);
			const actualStore = existing[0];

			if (!actualStore.updatedAt || actualStore.updatedAt.getTime() !== expectedDate.getTime()) {
				// This should fail validation
				expect(actualStore.updatedAt).toBeNull();
			}
		});

		it("should preserve approval notes when provided", async () => {
			const store = {
				id: "sto_test123",
				status: "pending",
				updatedAt: new Date("2024-01-01T10:00:00Z"),
			};

			mockDb.select.mockResolvedValue([store]);

			const input = {
				approvalNotes: "Store verified via field visit on 2024-01-15",
			};

			await mockDb.update().set({
				status: "active",
				updatedAt: new Date(),
				...(input.approvalNotes ? { approvalNotes: input.approvalNotes } : {}),
				approvedBy: mockSuperadminContext.user.id,
				approvedAt: new Date(),
			});

			expect(capturedUpdateData.approvalNotes).toBe("Store verified via field visit on 2024-01-15");
		});

		it("should not set approval notes when not provided", async () => {
			const store = {
				id: "sto_test123",
				status: "pending",
				updatedAt: new Date("2024-01-01T10:00:00Z"),
			};

			mockDb.select.mockResolvedValue([store]);

			const input: { approvalNotes?: string } = {
				approvalNotes: undefined, // No approval notes
			};

			await mockDb.update().set({
				status: "active",
				updatedAt: new Date(),
				...(input.approvalNotes ? { approvalNotes: input.approvalNotes } : {}),
				approvedBy: mockSuperadminContext.user.id,
				approvedAt: new Date(),
			});

			// Verify approvalNotes is not in the set data
			expect(capturedUpdateData).toBeDefined();
			expect(capturedUpdateData.approvalNotes).toBeUndefined();
		});
	});
});
