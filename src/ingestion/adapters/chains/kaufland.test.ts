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
