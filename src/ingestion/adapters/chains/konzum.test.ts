import { describe, expect, it } from "vitest";
import { KonzumAdapter } from "./konzum";

describe("KonzumAdapter store identifier extraction", () => {
	it("extracts 4-digit store code from comma-separated filename", () => {
		const adapter = new KonzumAdapter();
		const identifier = adapter.extractStoreIdentifier({
			url: "https://example.test/HIPERMARKET,ANTUNA%20GUSTAVA%20MATOŠA%2010%2021210%20SOLIN,3290,54922,13.02.2026,%2005-22.CSV",
			filename:
				"HIPERMARKET,ANTUNA GUSTAVA MATOŠA 10 21210 SOLIN,3290,54922,13.02.2026, 05-22.CSV",
			type: "csv",
		});

		expect(identifier).toEqual({
			type: "filename_code",
			value: "3290",
		});
	});
});

describe("KonzumAdapter store metadata extraction", () => {
	it("extracts city and address from real filename format", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/HIPERMARKET,ANTUNA%20GUSTAVA%20MATOŠA%2010%2021210%20SOLIN,3290,54922,13.02.2026,%2005-22.CSV",
			filename:
				"HIPERMARKET,ANTUNA GUSTAVA MATOŠA 10 21210 SOLIN,3290,54922,13.02.2026, 05-22.CSV",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum SOLIN",
			address: "ANTUNA GUSTAVA MATOŠA 10",
			city: "SOLIN",
			postalCode: "21210",
		});
	});

	it("extracts multi-word city from filename", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/HIPERMARKET,BJELOVARSKA%2048B%2010360%20SESVETE,0201,54758,13.02.2026,%2005-21.CSV",
			filename:
				"HIPERMARKET,BJELOVARSKA 48B 10360 SESVETE,0201,54758,13.02.2026, 05-21.CSV",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum SESVETE",
			address: "BJELOVARSKA 48B",
			city: "SESVETE",
			postalCode: "10360",
		});
	});

	it("extracts Zagreb with street name", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/HIPERMARKET,DANKOVEČKA%2095%2010040%20ZAGREB,0220,54769,13.02.2026,%2005-21.CSV",
			filename:
				"HIPERMARKET,DANKOVEČKA 95 10040 ZAGREB,0220,54769,13.02.2026, 05-21.CSV",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum ZAGREB",
			address: "DANKOVEČKA 95",
			city: "ZAGREB",
			postalCode: "10040",
		});
	});

	it("extracts city with multi-word street", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/HIPERMARKET,GRADA%20WIRGESA%202C%2010430%20SAMOBOR,0202,54759,13.02.2026,%2005-21.CSV",
			filename:
				"HIPERMARKET,GRADA WIRGESA 2C 10430 SAMOBOR,0202,54759,13.02.2026, 05-21.CSV",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Konzum SAMOBOR",
			address: "GRADA WIRGESA 2C",
			city: "SAMOBOR",
			postalCode: "10430",
		});
	});

	it("falls back to store code when parsing fails", () => {
		const adapter = new KonzumAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/konzum_simple.csv",
			filename: "konzum_simple.csv",
			type: "csv",
		});

		expect(metadata?.name).toMatch(/^Konzum/);
	});
});
