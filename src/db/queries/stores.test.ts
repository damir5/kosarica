/**
 * Tests for Store Query Helpers
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getEffectivePriceStoreId,
	getPriceForStoreItem,
	getPricesForStore,
	getPricesForStores,
	getStoreWithPriceSource,
} from "./stores";

// Mock store data
const virtualStore = {
	id: "sto_virtual",
	chainSlug: "konzum",
	name: "Konzum Virtual Store",
	address: null,
	city: null,
	postalCode: null,
	latitude: null,
	longitude: null,
	isVirtual: true,
	priceSourceStoreId: null,
	status: "active",
	createdAt: new Date(),
	updatedAt: new Date(),
};

const physicalStore = {
	id: "sto_physical",
	chainSlug: "konzum",
	name: "Konzum Zagreb",
	address: "Ilica 1",
	city: "Zagreb",
	postalCode: "10000",
	latitude: "45.8131",
	longitude: "15.9775",
	isVirtual: false,
	priceSourceStoreId: "sto_virtual",
	status: "active",
	createdAt: new Date(),
	updatedAt: new Date(),
};

const priceRecord = {
	id: "sis_price1",
	storeId: "sto_virtual",
	retailerItemId: "rit_item1",
	currentPrice: 1999,
	previousPrice: 2199,
	discountPrice: null,
	discountStart: null,
	discountEnd: null,
	inStock: true,
	unitPrice: 199,
	unitPriceBaseQuantity: "100",
	unitPriceBaseUnit: "g",
	lowestPrice30d: 1899,
	anchorPrice: null,
	anchorPriceAsOf: null,
	priceSignature: "abc123",
	lastSeenAt: new Date(),
	updatedAt: new Date(),
};

describe("getEffectivePriceStoreId", () => {
	it("should return own id for virtual stores (no priceSourceStoreId)", () => {
		const result = getEffectivePriceStoreId({
			id: "sto_abc",
			priceSourceStoreId: null,
		});
		expect(result).toBe("sto_abc");
	});

	it("should return priceSourceStoreId for physical stores", () => {
		const result = getEffectivePriceStoreId({
			id: "sto_xyz",
			priceSourceStoreId: "sto_abc",
		});
		expect(result).toBe("sto_abc");
	});
});

describe("getStoreWithPriceSource", () => {
	let mockDb: ReturnType<typeof createMockDb>;

	function createMockDb() {
		return {
			query: {
				stores: {
					findFirst: vi.fn(),
				},
				storeItemState: {
					findMany: vi.fn(),
				},
			},
		};
	}

	beforeEach(() => {
		mockDb = createMockDb();
	});

	it("should return null if store not found", async () => {
		mockDb.query.stores.findFirst.mockResolvedValue(null);

		const result = await getStoreWithPriceSource(mockDb, "sto_notfound");

		expect(result).toBeNull();
	});

	it("should return same store for price source when no priceSourceStoreId", async () => {
		mockDb.query.stores.findFirst.mockResolvedValue(virtualStore);

		const result = await getStoreWithPriceSource(mockDb, "sto_virtual");

		expect(result).not.toBeNull();
		expect(result?.store).toBe(virtualStore);
		expect(result?.priceStore).toBe(virtualStore);
		expect(result?.usesSharedPricing).toBe(false);
	});

	it("should return resolved price source store for physical stores", async () => {
		mockDb.query.stores.findFirst
			.mockResolvedValueOnce(physicalStore)
			.mockResolvedValueOnce(virtualStore);

		const result = await getStoreWithPriceSource(mockDb, "sto_physical");

		expect(result).not.toBeNull();
		expect(result?.store).toBe(physicalStore);
		expect(result?.priceStore).toBe(virtualStore);
		expect(result?.usesSharedPricing).toBe(true);
	});

	it("should fall back to original store if price source not found", async () => {
		mockDb.query.stores.findFirst
			.mockResolvedValueOnce(physicalStore)
			.mockResolvedValueOnce(null); // price source not found

		const result = await getStoreWithPriceSource(mockDb, "sto_physical");

		expect(result).not.toBeNull();
		expect(result?.store).toBe(physicalStore);
		expect(result?.priceStore).toBe(physicalStore);
		expect(result?.usesSharedPricing).toBe(false);
	});
});

describe("getPricesForStore", () => {
	let mockDb: ReturnType<typeof createMockDb>;

	function createMockDb() {
		return {
			query: {
				stores: {
					findFirst: vi.fn(),
					findMany: vi.fn(),
				},
				storeItemState: {
					findMany: vi.fn(),
				},
			},
		};
	}

	beforeEach(() => {
		mockDb = createMockDb();
	});

	it("should return empty array if store not found", async () => {
		mockDb.query.stores.findFirst.mockResolvedValue(null);

		const result = await getPricesForStore(mockDb, "sto_notfound");

		expect(result).toEqual([]);
	});

	it("should query prices from virtual store for physical stores", async () => {
		mockDb.query.stores.findFirst.mockResolvedValue(physicalStore);
		mockDb.query.storeItemState.findMany.mockResolvedValue([priceRecord]);

		const result = await getPricesForStore(mockDb, "sto_physical");

		expect(result).toEqual([priceRecord]);
		// Verify the query was made with the virtual store ID
		expect(mockDb.query.storeItemState.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: undefined,
			}),
		);
	});

	it("should apply limit option", async () => {
		mockDb.query.stores.findFirst.mockResolvedValue(virtualStore);
		mockDb.query.storeItemState.findMany.mockResolvedValue([priceRecord]);

		await getPricesForStore(mockDb, "sto_virtual", { limit: 10 });

		expect(mockDb.query.storeItemState.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 10,
			}),
		);
	});
});

describe("getPricesForStores", () => {
	let mockDb: ReturnType<typeof createMockDb>;

	function createMockDb() {
		return {
			query: {
				stores: {
					findFirst: vi.fn(),
					findMany: vi.fn(),
				},
				storeItemState: {
					findMany: vi.fn(),
				},
			},
		};
	}

	beforeEach(() => {
		mockDb = createMockDb();
	});

	it("should return empty map for empty store list", async () => {
		const result = await getPricesForStores(mockDb, [], "rit_item1");

		expect(result.size).toBe(0);
	});

	it("should map prices back to original store IDs", async () => {
		// Two physical stores share the same virtual store
		const physical1 = { ...physicalStore, id: "sto_phys1" };
		const physical2 = { ...physicalStore, id: "sto_phys2" };

		mockDb.query.stores.findMany.mockResolvedValue([physical1, physical2]);
		mockDb.query.storeItemState.findMany.mockResolvedValue([priceRecord]);

		const result = await getPricesForStores(
			mockDb,
			["sto_phys1", "sto_phys2"],
			"rit_item1",
		);

		// Both physical stores should have the same price from the virtual store
		expect(result.size).toBe(2);
		expect(result.get("sto_phys1")).toBe(priceRecord);
		expect(result.get("sto_phys2")).toBe(priceRecord);
	});
});

describe("getPriceForStoreItem", () => {
	let mockDb: ReturnType<typeof createMockDb>;

	function createMockDb() {
		return {
			query: {
				stores: {
					findFirst: vi.fn(),
				},
				storeItemState: {
					findMany: vi.fn(),
				},
			},
		};
	}

	beforeEach(() => {
		mockDb = createMockDb();
	});

	it("should return null if no price found", async () => {
		mockDb.query.stores.findFirst.mockResolvedValue(virtualStore);
		mockDb.query.storeItemState.findMany.mockResolvedValue([]);

		const result = await getPriceForStoreItem(
			mockDb,
			"sto_virtual",
			"rit_item1",
		);

		expect(result).toBeNull();
	});

	it("should return the price if found", async () => {
		mockDb.query.stores.findFirst.mockResolvedValue(virtualStore);
		mockDb.query.storeItemState.findMany.mockResolvedValue([priceRecord]);

		const result = await getPriceForStoreItem(
			mockDb,
			"sto_virtual",
			"rit_item1",
		);

		expect(result).toBe(priceRecord);
	});
});
