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
});
