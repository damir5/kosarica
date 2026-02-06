import { describe, expect, it } from "vitest";
import type { DiscoveredFile } from "../../types";
import { TrgocentarAdapter } from "./trgocentar";

function makeFile(filename: string): DiscoveredFile {
	return {
		url: `https://example.test/${filename}`,
		filename,
		type: "xml",
	};
}

describe("TrgocentarAdapter store metadata extraction", () => {
	it("extracts multi-word city and full street from filename identifier", () => {
		const adapter = new TrgocentarAdapter();
		const metadata = adapter.extractStoreMetadata(
			makeFile("SUPERMARKET_HUM_NA_SUTLI_185_HUM_NA_SUTLI_P220_010_100120260746.xml"),
		);

		expect(metadata).toEqual({
			name: "Trgocentar HUM NA SUTLI",
			address: "HUM NA SUTLI 185",
			city: "HUM NA SUTLI",
			postalCode: undefined,
		});
	});

	it("falls back to first-token street split when no house number exists", () => {
		const adapter = new TrgocentarAdapter();
		const metadata = adapter.extractStoreMetadata(
			makeFile("SUPERMARKET_VRANKOVEC_SV_KRIZ_ZACRETJE_P100_018_180120260744.xml"),
		);

		expect(metadata).toEqual({
			name: "Trgocentar SV KRIZ ZACRETJE",
			address: "VRANKOVEC",
			city: "SV KRIZ ZACRETJE",
			postalCode: undefined,
		});
	});

	it("extracts postal code when present in identifier", () => {
		const adapter = new TrgocentarAdapter();
		const metadata = adapter.extractStoreMetadata(
			makeFile("SUPERMARKET_ULICA_BANA_10_10000_ZAGREB_P001_001_010120260700.xml"),
		);

		expect(metadata).toEqual({
			name: "Trgocentar ZAGREB",
			address: "ULICA BANA 10",
			city: "ZAGREB",
			postalCode: "10000",
		});
	});
});
