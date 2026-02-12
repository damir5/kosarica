import { describe, expect, it } from "vitest";
import { KonzumAdapter } from "./konzum";

describe("KonzumAdapter store identifier extraction", () => {
	it("extracts 4-digit store code from comma-separated filename", () => {
		const adapter = new KonzumAdapter();
		const identifier = adapter.extractStoreIdentifier({
			url: "https://example.test/Konzum,2026-02-12,1234,Zagreb,Ulica 1.csv",
			filename: "Konzum,2026-02-12,1234,Zagreb,Ulica 1.csv",
			type: "csv",
		});

		expect(identifier).toEqual({
			type: "filename_code",
			value: "1234",
		});
	});
});

describe("KonzumAdapter store metadata extraction", () => {
	it("extracts city and address skipping date fields", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Konzum,1234,2026-02-12,Zagreb,Ilica 1.csv",
			filename: "Konzum,1234,2026-02-12,Zagreb,Ilica 1.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum Zagreb",
			address: "Ilica 1",
			city: "Zagreb",
		});
	});

	it("extracts city when date is between store code and city", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Konzum,2026-02-12,5678,12.02.2026.,Split,Poljička 25.csv",
			filename: "Konzum,2026-02-12,5678,12.02.2026.,Split,Poljička 25.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum Split",
			address: "Poljička 25",
			city: "Split",
		});
	});

	it("extracts city and address in standard format", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Konzum,2026-02-12,9999,Rijeka,Korzo 1.csv",
			filename: "Konzum,2026-02-12,9999,Rijeka,Korzo 1.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum Rijeka",
			address: "Korzo 1",
			city: "Rijeka",
		});
	});

	it("handles filename with underscores in city name", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Konzum,1111,Donja_Dubrava,Main_Street.csv",
			filename: "Konzum,1111,Donja_Dubrava,Main_Street.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum Donja Dubrava",
			address: "Main Street",
			city: "Donja Dubrava",
		});
	});

	it("falls back to store code when city is not found", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Konzum,2222.csv",
			filename: "Konzum,2222.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum 2222",
		});
	});
});
