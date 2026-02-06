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

	it("keeps supermarket code when filename includes address and city", () => {
		const adapter = new LidlAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Supermarket 184_Jadranska magistrala_1a_23210_Biograd na Moru_1_02.02.2026_7.15h.csv",
			filename:
				"Supermarket 184_Jadranska magistrala_1a_23210_Biograd na Moru_1_02.02.2026_7.15h.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Lidl 184",
		});
	});
});
