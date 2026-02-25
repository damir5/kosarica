import { describe, expect, it } from "vitest";
import { KauflandAdapter } from "./kaufland";

describe("KauflandAdapter store metadata extraction", () => {
	it("extracts street and city from filename", () => {
		const adapter = new KauflandAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Hipermarket_Julija_Knifera_1_Zagreb_4430_06022026_7-30.csv",
			filename: "Hipermarket_Julija_Knifera_1_Zagreb_4430_06022026_7-30.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Kaufland Zagreb",
			address: "Julija Knifera 1",
			city: "Zagreb",
		});
	});

	it("extracts multi-word city from another real filename", () => {
		const adapter = new KauflandAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Supermarket_Zagrebacka_ulica_67_Dugo_Selo_5030_19012026_7-30.csv",
			filename: "Supermarket_Zagrebacka_ulica_67_Dugo_Selo_5030_19012026_7-30.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Kaufland Dugo Selo",
			address: "Zagrebacka ulica 67",
			city: "Dugo Selo",
		});
	});
});

describe("KauflandAdapter row validation", () => {
	function buildRow(overrides?: {
		name?: string;
		brand?: string;
	}): Parameters<KauflandAdapter["validateRow"]>[0] {
		return {
			storeIdentifier: "4430",
			externalId: "12345",
			name: overrides?.name ?? "Coca Cola 2L",
			category: "PIĆE",
			brand: overrides?.brand ?? "Coca Cola",
			unit: "L",
			unitQuantity: "2",
			price: 299,
			priceStatus: "available",
			barcodes: ["3850000000000"],
			rowNumber: 2,
			rawData: '["12345","Coca Cola 2L","PIĆE","Coca Cola","L","2","2.99"]',
		};
	}

	it("rejects rows where brand is a category value", () => {
		const adapter = new KauflandAdapter();
		const validation = adapter.validateRow(buildRow({ brand: "PIĆE" }));

		expect(validation.isValid).toBe(false);
		expect(validation.errors).toContain(
			"Brand column contains category value (possible CSV column shift)",
		);
	});

	it("rejects rows where brand looks like a price", () => {
		const adapter = new KauflandAdapter();
		const validation = adapter.validateRow(buildRow({ brand: "1.000" }));

		expect(validation.isValid).toBe(false);
		expect(validation.errors).toContain(
			"Brand column contains numeric value (possible CSV column shift)",
		);
	});

	it("rejects rows where brand looks like a barcode", () => {
		const adapter = new KauflandAdapter();
		const validation = adapter.validateRow(buildRow({ brand: "4063367412301" }));

		expect(validation.isValid).toBe(false);
		expect(validation.errors).toContain(
			"Brand column contains numeric value (possible CSV column shift)",
		);
	});

	it("rejects rows where name is numeric-only", () => {
		const adapter = new KauflandAdapter();
		const validation = adapter.validateRow(buildRow({ name: "49" }));

		expect(validation.isValid).toBe(false);
		expect(validation.errors).toContain(
			"Name is numeric-only (possible CSV column shift)",
		);
	});

	it("keeps valid rows ingestible", () => {
		const adapter = new KauflandAdapter();
		const validation = adapter.validateRow(buildRow());

		expect(validation.isValid).toBe(true);
		expect(validation.errors).toEqual([]);
	});
});
