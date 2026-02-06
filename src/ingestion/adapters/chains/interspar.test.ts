import { describe, expect, it } from "vitest";
import { IntersparAdapter } from "./interspar";

describe("IntersparAdapter store metadata extraction", () => {
	it("extracts city and address from filename", () => {
		const adapter = new IntersparAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/supermarket_zagreb_nikole_jurisica_2a_87172_spar_zg_jurisiceva_0281_20260206_0330.csv",
			filename:
				"supermarket_zagreb_nikole_jurisica_2a_87172_spar_zg_jurisiceva_0281_20260206_0330.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Interspar zagreb",
			address: "nikole jurisica 2a",
			city: "zagreb",
		});
	});
});
