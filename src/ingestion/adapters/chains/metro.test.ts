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

	it("extracts city with suffix from encoded segment", () => {
		const adapter = new MetroAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/cash_and_carry_prodavaonica_METRO_20260119T0630_S11_SLAVONSKA_AVENIJA_71%2C_ZAGREB_-_SESVETE.csv",
			filename:
				"cash_and_carry_prodavaonica_METRO_20260119T0630_S11_SLAVONSKA_AVENIJA_71%2C_ZAGREB_-_SESVETE.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Metro ZAGREB - SESVETE",
			address: "SLAVONSKA AVENIJA 71",
			city: "ZAGREB - SESVETE",
		});
	});
});
