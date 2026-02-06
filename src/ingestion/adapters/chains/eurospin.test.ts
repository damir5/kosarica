import { describe, expect, it } from "vitest";
import { EurospinAdapter } from "./eurospin";

describe("EurospinAdapter store metadata extraction", () => {
	it("extracts normalized street/city/postal code from filename identifier", () => {
		const adapter = new EurospinAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/prodavaonica-310002-I_Štefanovecki_zavoj_12-Zagreb_Dubec-10360-310002010226-01.02.2026-7.30.xml",
			filename:
				"prodavaonica-310002-I_Štefanovecki_zavoj_12-Zagreb_Dubec-10360-310002010226-01.02.2026-7.30.xml",
			type: "xml",
		});

		expect(metadata).toEqual({
			name: "Eurospin Zagreb Dubec",
			address: "I Štefanovecki zavoj 12",
			city: "Zagreb Dubec",
			postalCode: "10360",
		});
	});
});
