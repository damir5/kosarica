import iconv from "iconv-lite";
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

	it("extracts city from filename with missing postal code detection", () => {
		const adapter = new PlodineAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/SUPERMARKET_Ilica_15_10000_Zagreb_001_123_06022026.csv",
			filename: "SUPERMARKET_Ilica_15_10000_Zagreb_001_123_06022026.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Plodine Zagreb",
			address: "Ilica 15",
			city: "Zagreb",
			postalCode: "10000",
		});
	});

	it("uses store code when no meaningful city found", () => {
		const adapter = new PlodineAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/cjenici_123_06022026.csv",
			filename: "cjenici_123_06022026.csv",
			type: "csv",
		});

		expect(metadata?.name).toMatch(/^Plodine/);
	});

	it("parses cp1250 csv without replacement characters", async () => {
		const adapter = new PlodineAdapter();
		const csv =
			"Sifra proizvoda;Naziv proizvoda;Maloprodajna cijena;Barkod\n" +
			"12345;ŽVAKE ČOKOLADNE;1,99;3850000000000";
		const content = iconv.encode(csv, "windows-1250");

		const parsed = await adapter.parse(
			content,
			"SUPERMARKET_ZAGREBACKA_ULICA_62_10380_SVETI_IVAN_ZELINA_139_267_05022026015546.csv",
		);

		expect(parsed.isOk()).toBe(true);
		if (parsed.isErr()) {
			throw new Error(parsed.error.message);
		}

		expect(parsed.value.validRows).toBe(1);
		expect(parsed.value.rows[0]?.name).toBe("ŽVAKE ČOKOLADNE");
		expect(parsed.value.rows[0]?.name.includes("�")).toBe(false);
	});
});
