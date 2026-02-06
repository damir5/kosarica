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
});
