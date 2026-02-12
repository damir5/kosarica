import { describe, expect, it } from "vitest";
import { LidlAdapter } from "./lidl";

describe("LidlAdapter store metadata extraction", () => {
	it("normalizes supermarket code names", () => {
		const adapter = new LidlAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/po_trgovinama_na_dan_09_01_2026/Supermarket 112.zip",
			filename: "Supermarket 112.zip",
			type: "zip",
		});

		expect(metadata).toEqual({
			name: "Lidl 112",
		});
	});

	it("extracts city and address from supermarket with details", () => {
		const adapter = new LidlAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Supermarket 184_Jadranska magistrala_1a_23210_Biograd na Moru_1_02.02.2026_7.15h.csv",
			filename:
				"Supermarket 184_Jadranska magistrala_1a_23210_Biograd na Moru_1_02.02.2026_7.15h.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Lidl Biograd na Moru",
			address: "Jadranska magistrala 1a",
			city: "Biograd na Moru",
		});
	});

	it("extracts city from simple city filename", () => {
		const adapter = new LidlAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Lidl_2026_02_12_Zagreb.csv",
			filename: "Lidl_2026_02_12_Zagreb.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Lidl Zagreb",
			city: "Zagreb",
		});
	});

	it("extracts city and address from city with street filename", () => {
		const adapter = new LidlAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Lidl_2026_02_12_Split_Poljicka_25.csv",
			filename: "Lidl_2026_02_12_Split_Poljicka_25.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Lidl Split",
			city: "Split",
			address: "Poljicka 25",
		});
	});

	it("handles numeric-only identifier", () => {
		const adapter = new LidlAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Lidl_123.csv",
			filename: "Lidl_123.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Lidl 123",
		});
	});
});
