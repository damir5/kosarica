import { describe, expect, it } from "vitest";
import { PlodineAdapter } from "./plodine";

describe("PlodineAdapter store metadata extraction", () => {
	it("extracts address, city and postal code from supermarket filename", () => {
		const adapter = new PlodineAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/SUPERMARKET_ZAGREBACKA_ULICA_62_10380_SVETI_IVAN_ZELINA_139_267_05022026015546.csv",
			filename:
				"SUPERMARKET_ZAGREBACKA_ULICA_62_10380_SVETI_IVAN_ZELINA_139_267_05022026015546.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Plodine SVETI IVAN ZELINA",
			address: "ZAGREBACKA ULICA 62",
			city: "SVETI IVAN ZELINA",
			postalCode: "10380",
		});
	});

	it("extracts metadata from filename with parenthesized city token", () => {
		const adapter = new PlodineAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/SUPERMARKET_CARLOTTE_GRISI_1_52466_NOVIGRAD(CITTANOVA)_076_256_25012026015128.csv",
			filename:
				"SUPERMARKET_CARLOTTE_GRISI_1_52466_NOVIGRAD(CITTANOVA)_076_256_25012026015128.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Plodine NOVIGRAD(CITTANOVA)",
			address: "CARLOTTE GRISI 1",
			city: "NOVIGRAD(CITTANOVA)",
			postalCode: "52466",
		});
	});
});
