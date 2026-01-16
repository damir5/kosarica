/**
 * Store Resolution Strategy Tests
 *
 * Tests for the store resolution logic in the ingestion pipeline.
 * Covers filename-first resolution, registry lookup fallback,
 * unresolved store handling, and chain-specific patterns.
 */

import { describe, expect, it } from "vitest";
import { DmAdapter } from "../chains/dm";
import { CHAIN_CONFIGS } from "../chains/index";
import { KonzumAdapter } from "../chains/konzum";
import { LidlAdapter } from "../chains/lidl";
import { MetroAdapter } from "../chains/metro";
import { StudenacAdapter } from "../chains/studenac";
import type { DiscoveredFile } from "./types";

// ============================================================================
// Mock Database Setup
// ============================================================================

/**
 * In-memory store data for testing
 */
interface MockStore {
	id: string;
	chainSlug: string;
	name: string;
	address: string | null;
	city: string | null;
	postalCode: string | null;
	latitude: string | null;
	longitude: string | null;
}

interface MockStoreIdentifier {
	id: string;
	storeId: string;
	type: string;
	value: string;
}

/**
 * Creates a mock database with actual filtering logic for store resolution
 */
function createTestDb(
	stores: MockStore[],
	identifiers: MockStoreIdentifier[],
): {
	resolveStore: (
		chainSlug: string,
		identifier: string,
		identifierType?: string,
	) => string | null;
} {
	// Simple in-memory resolution function
	const resolveStore = (
		chainSlug: string,
		identifier: string,
		identifierType: string = "filename_code",
	): string | null => {
		const matchingIdentifier = identifiers.find((id) => {
			if (id.type !== identifierType) return false;
			if (id.value !== identifier) return false;

			const store = stores.find((s) => s.id === id.storeId);
			if (!store) return false;
			if (store.chainSlug !== chainSlug) return false;

			return true;
		});

		return matchingIdentifier?.storeId ?? null;
	};

	return { resolveStore };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a mock DiscoveredFile for testing
 */
function createDiscoveredFile(
	filename: string,
	metadata: Record<string, string> = {},
): DiscoveredFile {
	return {
		url: `https://example.com/files/${filename}`,
		filename,
		type: filename.endsWith(".xml")
			? "xml"
			: filename.endsWith(".xlsx")
				? "xlsx"
				: "csv",
		size: null,
		lastModified: null,
		metadata,
	};
}

// ============================================================================
// Test Data
// ============================================================================

const testStores: MockStore[] = [
	{
		id: "sto_test_konzum_zagreb_1",
		chainSlug: "konzum",
		name: "Konzum Zagreb Ilica 123",
		address: "Ilica 123",
		city: "Zagreb",
		postalCode: "10000",
		latitude: "45.8150",
		longitude: "15.9819",
	},
	{
		id: "sto_test_konzum_split_1",
		chainSlug: "konzum",
		name: "Konzum Split Riva",
		address: "Riva 1",
		city: "Split",
		postalCode: "21000",
		latitude: "43.5081",
		longitude: "16.4402",
	},
	{
		id: "sto_test_lidl_42",
		chainSlug: "lidl",
		name: "Lidl Zagreb 42",
		address: "Avenija Dubrovnik 15",
		city: "Zagreb",
		postalCode: "10000",
		latitude: "45.7889",
		longitude: "15.9735",
	},
	{
		id: "sto_test_dm_national",
		chainSlug: "dm",
		name: "DM National",
		address: null,
		city: null,
		postalCode: null,
		latitude: null,
		longitude: null,
	},
	{
		id: "sto_test_studenac_123",
		chainSlug: "studenac",
		name: "Studenac Zadar 123",
		address: "Obala 5",
		city: "Zadar",
		postalCode: "23000",
		latitude: "44.1194",
		longitude: "15.2314",
	},
	{
		id: "sto_test_metro_1",
		chainSlug: "metro",
		name: "Metro Zagreb",
		address: "Jankomir 33",
		city: "Zagreb",
		postalCode: "10000",
		latitude: "45.8000",
		longitude: "15.9000",
	},
];

const testIdentifiers: MockStoreIdentifier[] = [
	// Konzum identifiers
	{
		id: "sid_1",
		storeId: "sto_test_konzum_zagreb_1",
		type: "filename_code",
		value: "Zagreb_Ilica_123",
	},
	{
		id: "sid_2",
		storeId: "sto_test_konzum_zagreb_1",
		type: "internal_id",
		value: "KZ001",
	},
	{
		id: "sid_3",
		storeId: "sto_test_konzum_split_1",
		type: "filename_code",
		value: "Split_Riva_1",
	},
	// Lidl identifiers
	{
		id: "sid_4",
		storeId: "sto_test_lidl_42",
		type: "filename_code",
		value: "42",
	},
	{
		id: "sid_5",
		storeId: "sto_test_lidl_42",
		type: "filename_code",
		value: "Zagreb_AvenijaDubrovnik_42",
	},
	// DM national identifier
	{
		id: "sid_6",
		storeId: "sto_test_dm_national",
		type: "national",
		value: "dm_national",
	},
	// Studenac identifiers
	{
		id: "sid_7",
		storeId: "sto_test_studenac_123",
		type: "portal_id",
		value: "123",
	},
	{
		id: "sid_8",
		storeId: "sto_test_studenac_123",
		type: "filename_code",
		value: "store_123",
	},
	// Metro identifiers
	{
		id: "sid_9",
		storeId: "sto_test_metro_1",
		type: "portal_id",
		value: "S10",
	},
	// Unresolved fallback identifier (for testing fallback behavior)
	{
		id: "sid_unresolved",
		storeId: "sto_test_konzum_zagreb_1",
		type: "unresolved",
		value: "UNKNOWN_STORE_123",
	},
];

// ============================================================================
// Tests: Filename-First Resolution
// ============================================================================

describe("Filename-First Resolution", () => {
	describe("Konzum filename patterns", () => {
		const adapter = new KonzumAdapter();

		it("extracts store identifier from standard Konzum filename", () => {
			const file = createDiscoveredFile("Konzum_Zagreb_Ilica_123_456.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("filename_code");
			expect(identifier?.value).toBe("Zagreb_Ilica_123_456");
		});

		it("extracts store identifier with cjenik prefix", () => {
			const file = createDiscoveredFile("cjenik_Zagreb_Main_Store.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("filename_code");
			expect(identifier?.value).toBe("Zagreb_Main_Store");
		});

		it("handles filename without prefix", () => {
			const file = createDiscoveredFile("Zagreb_Store_42.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("filename_code");
			expect(identifier?.value).toBe("Zagreb_Store_42");
		});

		it("handles uppercase extension", () => {
			const file = createDiscoveredFile("Konzum_Test.CSV");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.value).toBe("Test");
		});

		it("uses full basename when all prefixes removed results in empty string", () => {
			const file = createDiscoveredFile("Konzum.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			// When prefix removal leaves empty, it should use the original basename
			expect(identifier?.value).toBe("Konzum");
		});
	});

	describe("Lidl filename patterns", () => {
		const adapter = new LidlAdapter();

		it("extracts store ID from date-based filename", () => {
			const file = createDiscoveredFile("Lidl_2024-01-15_42.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("filename_code");
			expect(identifier?.value).toBe("42");
		});

		it("extracts location from poslovnica filename", () => {
			const file = createDiscoveredFile("Lidl_Poslovnica_Zagreb_Ilica_123.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("filename_code");
			expect(identifier?.value).toBe("Zagreb_Ilica_123");
		});

		it("extracts simple numeric store ID", () => {
			const file = createDiscoveredFile("Lidl_42.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("filename_code");
			expect(identifier?.value).toBe("42");
		});

		it("handles dash separator in date pattern", () => {
			const file = createDiscoveredFile("Lidl-2024-01-15-123.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.value).toBe("123");
		});

		it("handles underscore separator in poslovnica pattern", () => {
			const file = createDiscoveredFile("Lidl-Poslovnica-Split.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.value).toBe("Split");
		});
	});

	describe("Store resolution lookup", () => {
		it("finds store by filename_code identifier", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore(
				"konzum",
				"Zagreb_Ilica_123",
				"filename_code",
			);

			expect(storeId).toBe("sto_test_konzum_zagreb_1");
		});

		it("returns null for non-matching identifier", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore(
				"konzum",
				"NonExistent_Store",
				"filename_code",
			);

			expect(storeId).toBeNull();
		});

		it("respects chain slug when resolving", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// Same identifier value but different chain should not match
			const wrongChain = resolveStore(
				"lidl",
				"Zagreb_Ilica_123",
				"filename_code",
			);
			const rightChain = resolveStore(
				"konzum",
				"Zagreb_Ilica_123",
				"filename_code",
			);

			expect(wrongChain).toBeNull();
			expect(rightChain).toBe("sto_test_konzum_zagreb_1");
		});

		it("matches exact identifier value (case sensitive)", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			const lowercase = resolveStore(
				"konzum",
				"zagreb_ilica_123",
				"filename_code",
			);
			const uppercase = resolveStore(
				"konzum",
				"ZAGREB_ILICA_123",
				"filename_code",
			);
			const correct = resolveStore(
				"konzum",
				"Zagreb_Ilica_123",
				"filename_code",
			);

			expect(lowercase).toBeNull();
			expect(uppercase).toBeNull();
			expect(correct).toBe("sto_test_konzum_zagreb_1");
		});
	});
});

// ============================================================================
// Tests: Registry Lookup Fallback
// ============================================================================

describe("Registry Lookup Fallback", () => {
	describe("Multiple identifier types per store", () => {
		it("resolves store using internal_id when filename_code fails", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// First try with filename_code (not found)
			const byFilename = resolveStore("konzum", "KZ001", "filename_code");
			expect(byFilename).toBeNull();

			// Then try with internal_id (should work)
			const byInternalId = resolveStore("konzum", "KZ001", "internal_id");
			expect(byInternalId).toBe("sto_test_konzum_zagreb_1");
		});

		it("supports multiple identifiers for same store", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// Both should resolve to the same store
			const byId42 = resolveStore("lidl", "42", "filename_code");
			const byLocation = resolveStore(
				"lidl",
				"Zagreb_AvenijaDubrovnik_42",
				"filename_code",
			);

			expect(byId42).toBe("sto_test_lidl_42");
			expect(byLocation).toBe("sto_test_lidl_42");
		});
	});

	describe("Studenac portal_id resolution", () => {
		const adapter = new StudenacAdapter();

		it("extracts portal_id from metadata", () => {
			const file = createDiscoveredFile("studenac_prices.xml", {
				storeId: "123",
			});
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("portal_id");
			expect(identifier?.value).toBe("123");
		});

		it("falls back to filename when no metadata", () => {
			const file = createDiscoveredFile("Studenac_store_456.xml");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("filename_code");
			expect(identifier?.value).toBe("456");
		});

		it("resolves store using portal_id", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore("studenac", "123", "portal_id");

			expect(storeId).toBe("sto_test_studenac_123");
		});

		it("resolves store using filename_code as fallback", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore("studenac", "store_123", "filename_code");

			expect(storeId).toBe("sto_test_studenac_123");
		});
	});

	describe("Metro portal_id resolution", () => {
		const adapter = new MetroAdapter();

		it("extracts portal_id from filename", () => {
			const file = createDiscoveredFile(
				"cash_and_carry_prodavaonica_METRO_20260105T0630_S10_JANKOMIR_31,ZAGREB.csv",
			);
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("portal_id");
			expect(identifier?.value).toBe("S10");
		});

		it("returns null when no store code in filename", () => {
			const file = createDiscoveredFile("metro_prices.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).toBeNull();
		});

		it("resolves store using portal_id", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore("metro", "S10", "portal_id");

			expect(storeId).toBe("sto_test_metro_1");
		});
	});
});

// ============================================================================
// Tests: Unresolved Fallback
// ============================================================================

describe("Unresolved Fallback", () => {
	describe("Handling unresolved stores", () => {
		it("returns null when no store found", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore(
				"konzum",
				"COMPLETELY_UNKNOWN",
				"filename_code",
			);

			expect(storeId).toBeNull();
		});

		it("returns null for empty identifier", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore("konzum", "", "filename_code");

			expect(storeId).toBeNull();
		});

		it("can resolve using unresolved identifier type", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// This tests the pattern where unresolved stores are explicitly mapped
			const storeId = resolveStore("konzum", "UNKNOWN_STORE_123", "unresolved");

			expect(storeId).toBe("sto_test_konzum_zagreb_1");
		});
	});

	describe("Edge cases", () => {
		it("handles whitespace-only identifier", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore("konzum", "   ", "filename_code");

			expect(storeId).toBeNull();
		});

		it("handles special characters in identifier", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore(
				"konzum",
				"Store/With\\Special<Chars>",
				"filename_code",
			);

			expect(storeId).toBeNull();
		});

		it("handles very long identifier", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const longIdentifier = "A".repeat(1000);
			const storeId = resolveStore("konzum", longIdentifier, "filename_code");

			expect(storeId).toBeNull();
		});
	});
});

// ============================================================================
// Tests: Different Chain Formats
// ============================================================================

describe("Different Chain Formats", () => {
	describe("DM National (single store for chain)", () => {
		const adapter = new DmAdapter();

		it("always returns national identifier regardless of filename", () => {
			const files = [
				createDiscoveredFile("dm_prices.xlsx"),
				createDiscoveredFile("DM_Cjenik_2024.xlsx"),
				createDiscoveredFile("random_filename.xlsx"),
			];

			for (const file of files) {
				const identifier = adapter.extractStoreIdentifier(file);

				expect(identifier).not.toBeNull();
				expect(identifier?.type).toBe("national");
				expect(identifier?.value).toBe("dm_national");
			}
		});

		it("resolves national store correctly", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore("dm", "dm_national", "national");

			expect(storeId).toBe("sto_test_dm_national");
		});

		it("chain config indicates national store resolution", () => {
			const config = CHAIN_CONFIGS.dm;
			expect(config.storeResolution).toBe("national");
		});
	});

	describe("Chain configuration verification", () => {
		it("Konzum uses filename resolution", () => {
			const config = CHAIN_CONFIGS.konzum;
			expect(config.storeResolution).toBe("filename");
		});

		it("Lidl uses filename resolution", () => {
			const config = CHAIN_CONFIGS.lidl;
			expect(config.storeResolution).toBe("filename");
		});

		it("Studenac uses portal_id resolution", () => {
			const config = CHAIN_CONFIGS.studenac;
			expect(config.storeResolution).toBe("portal_id");
		});

		it("Metro uses portal_id resolution", () => {
			const config = CHAIN_CONFIGS.metro;
			expect(config.storeResolution).toBe("portal_id");
		});

		it("all chains have a valid storeResolution strategy", () => {
			const validStrategies = ["filename", "portal_id", "national"];

			for (const [chainId, config] of Object.entries(CHAIN_CONFIGS)) {
				expect(
					validStrategies,
					`Chain ${chainId} has invalid storeResolution`,
				).toContain(config.storeResolution);
			}
		});
	});

	describe("Plodine filename pattern", () => {
		// Note: Plodine uses similar filename patterns to Konzum
		it("chain config uses filename resolution", () => {
			const config = CHAIN_CONFIGS.plodine;
			expect(config.storeResolution).toBe("filename");
		});
	});

	describe("Interspar filename pattern", () => {
		it("chain config uses filename resolution", () => {
			const config = CHAIN_CONFIGS.interspar;
			expect(config.storeResolution).toBe("filename");
		});
	});

	describe("Kaufland filename pattern", () => {
		it("chain config uses filename resolution", () => {
			const config = CHAIN_CONFIGS.kaufland;
			expect(config.storeResolution).toBe("filename");
		});
	});

	describe("Eurospin filename pattern", () => {
		it("chain config uses filename resolution", () => {
			const config = CHAIN_CONFIGS.eurospin;
			expect(config.storeResolution).toBe("filename");
		});
	});

	describe("KTC filename pattern", () => {
		it("chain config uses filename resolution", () => {
			const config = CHAIN_CONFIGS.ktc;
			expect(config.storeResolution).toBe("filename");
		});
	});

	describe("Trgocentar filename pattern", () => {
		it("chain config uses filename resolution", () => {
			const config = CHAIN_CONFIGS.trgocentar;
			expect(config.storeResolution).toBe("filename");
		});
	});
});

// ============================================================================
// Tests: Edge Cases and Error Handling
// ============================================================================

describe("Edge Cases and Error Handling", () => {
	describe("Invalid inputs", () => {
		it("handles empty filename gracefully in adapter", () => {
			const adapter = new KonzumAdapter();
			// TypeScript won't allow null, but runtime might receive it
			const file = createDiscoveredFile("");
			const identifier = adapter.extractStoreIdentifier(file);

			// Empty filename results in null identifier (no valid store identifier)
			// This is expected behavior - empty strings should not resolve to stores
			expect(identifier).toBeNull();
		});

		it("handles file with only extension", () => {
			const adapter = new KonzumAdapter();
			const file = createDiscoveredFile(".csv");
			const identifier = adapter.extractStoreIdentifier(file);

			// File with only extension results in empty basename after prefix removal
			// This correctly returns null since there's no meaningful identifier
			expect(identifier).toBeNull();
		});
	});

	describe("Multiple stores with similar identifiers", () => {
		it("returns first match when multiple could match", () => {
			// Create test data with potential ambiguity
			const stores: MockStore[] = [
				{
					id: "sto_1",
					chainSlug: "konzum",
					name: "Store 1",
					address: null,
					city: null,
					postalCode: null,
					latitude: null,
					longitude: null,
				},
				{
					id: "sto_2",
					chainSlug: "konzum",
					name: "Store 2",
					address: null,
					city: null,
					postalCode: null,
					latitude: null,
					longitude: null,
				},
			];

			const identifiers: MockStoreIdentifier[] = [
				{ id: "sid_1", storeId: "sto_1", type: "filename_code", value: "test" },
				// Note: In practice, duplicate identifiers should not exist
			];

			const { resolveStore } = createTestDb(stores, identifiers);
			const storeId = resolveStore("konzum", "test", "filename_code");

			expect(storeId).toBe("sto_1");
		});
	});

	describe("Identifier type validation", () => {
		it("respects identifier type filter", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// Same value but different type should not match
			const asFilename = resolveStore("studenac", "123", "filename_code");
			const asPortalId = resolveStore("studenac", "123", "portal_id");

			// '123' is registered as portal_id, not filename_code
			expect(asFilename).toBeNull();
			expect(asPortalId).toBe("sto_test_studenac_123");
		});

		it("handles unknown identifier type gracefully", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);
			const storeId = resolveStore(
				"konzum",
				"Zagreb_Ilica_123",
				"unknown_type_xyz",
			);

			expect(storeId).toBeNull();
		});
	});

	describe("Cross-chain isolation", () => {
		it("does not resolve store from different chain", () => {
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// Lidl store should not resolve when querying Konzum
			const wrongChain = resolveStore("konzum", "42", "filename_code");
			const rightChain = resolveStore("lidl", "42", "filename_code");

			expect(wrongChain).toBeNull();
			expect(rightChain).toBe("sto_test_lidl_42");
		});
	});
});

// ============================================================================
// Tests: Integration with Chain Adapters
// ============================================================================

describe("Integration with Chain Adapters", () => {
	describe("End-to-end filename to store resolution", () => {
		it("Konzum: filename -> identifier -> store", () => {
			const adapter = new KonzumAdapter();
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// Step 1: Extract identifier from filename
			const file = createDiscoveredFile("Konzum_Zagreb_Ilica_123.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();

			// Step 2: Resolve store using extracted identifier
			const storeId = resolveStore(
				"konzum",
				identifier?.value,
				identifier?.type,
			);

			expect(storeId).toBe("sto_test_konzum_zagreb_1");
		});

		it("Lidl: filename -> identifier -> store", () => {
			const adapter = new LidlAdapter();
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// Step 1: Extract identifier from filename
			const file = createDiscoveredFile("Lidl_2024-01-15_42.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();

			// Step 2: Resolve store using extracted identifier
			const storeId = resolveStore("lidl", identifier?.value, identifier?.type);

			expect(storeId).toBe("sto_test_lidl_42");
		});

		it("DM: any filename -> national identifier -> store", () => {
			const adapter = new DmAdapter();
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// Step 1: Extract identifier (always national)
			const file = createDiscoveredFile("any_dm_file.xlsx");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("national");

			// Step 2: Resolve store using extracted identifier
			const storeId = resolveStore("dm", identifier?.value, identifier?.type);

			expect(storeId).toBe("sto_test_dm_national");
		});

		it("Studenac: metadata -> identifier -> store", () => {
			const adapter = new StudenacAdapter();
			const { resolveStore } = createTestDb(testStores, testIdentifiers);

			// Step 1: Extract identifier from metadata
			const file = createDiscoveredFile("studenac.xml", { storeId: "123" });
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier).not.toBeNull();
			expect(identifier?.type).toBe("portal_id");

			// Step 2: Resolve store using extracted identifier
			const storeId = resolveStore(
				"studenac",
				identifier?.value,
				identifier?.type,
			);

			expect(storeId).toBe("sto_test_studenac_123");
		});
	});

	describe("Adapter identifier type consistency", () => {
		it("Konzum adapter uses filename_code type", () => {
			const adapter = new KonzumAdapter();
			const file = createDiscoveredFile("Konzum_Test.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier?.type).toBe("filename_code");
		});

		it("Lidl adapter uses filename_code type", () => {
			const adapter = new LidlAdapter();
			const file = createDiscoveredFile("Lidl_42.csv");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier?.type).toBe("filename_code");
		});

		it("DM adapter uses national type", () => {
			const adapter = new DmAdapter();
			const file = createDiscoveredFile("dm.xlsx");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier?.type).toBe("national");
		});

		it("Studenac adapter uses portal_id type when metadata present", () => {
			const adapter = new StudenacAdapter();
			const file = createDiscoveredFile("studenac.xml", { storeId: "123" });
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier?.type).toBe("portal_id");
		});

		it("Studenac adapter falls back to filename_code when no metadata", () => {
			const adapter = new StudenacAdapter();
			const file = createDiscoveredFile("Studenac_store_456.xml");
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier?.type).toBe("filename_code");
		});

		it("Metro adapter uses portal_id type extracted from filename", () => {
			const adapter = new MetroAdapter();
			const file = createDiscoveredFile(
				"cash_and_carry_prodavaonica_METRO_20260105T0630_S10_JANKOMIR_31,ZAGREB.csv",
			);
			const identifier = adapter.extractStoreIdentifier(file);

			expect(identifier?.type).toBe("portal_id");
			expect(identifier?.value).toBe("S10");
		});
	});
});
