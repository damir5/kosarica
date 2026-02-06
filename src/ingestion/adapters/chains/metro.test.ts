import { describe, expect, it } from "vitest";
import { MetroAdapter } from "./metro";

describe("MetroAdapter store metadata extraction", () => {
	it("extracts city and address from encoded filename segment", () => {
		const adapter = new MetroAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/supermarket_METRO_20260206T0631_S16_TOMISLAVA_MACANA_2%2C_DUBROVNIK.csv",
			filename:
				"supermarket_METRO_20260206T0631_S16_TOMISLAVA_MACANA_2%2C_DUBROVNIK.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Metro DUBROVNIK",
			address: "TOMISLAVA MACANA 2",
			city: "DUBROVNIK",
		});
	});
});
