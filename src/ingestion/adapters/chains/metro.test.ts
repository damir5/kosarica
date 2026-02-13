import iconv from "iconv-lite";
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

	it("parses cp1250 csv and preserves diacritics after header preprocessing", async () => {
		const adapter = new MetroAdapter();
		const csv =
			'SIFRA,NAZIV,MPC,SIDRENA_12_01,BARKOD\n12345,"ŽITNE ČOKOLADICE","1,99","2,49",3850000000000';
		const content = iconv.encode(csv, "windows-1250");

		const parsed = await adapter.parse(
			content,
			"supermarket_METRO_20260206T0631_S16_TOMISLAVA_MACANA_2%2C_DUBROVNIK.csv",
		);

		expect(parsed.isOk()).toBe(true);
		if (parsed.isErr()) {
			throw new Error(parsed.error.message);
		}

		expect(parsed.value.validRows).toBe(1);
		expect(parsed.value.rows[0]?.name).toBe("ŽITNE ČOKOLADICE");
		expect(parsed.value.rows[0]?.name.includes("�")).toBe(false);
		expect(parsed.value.rows[0]?.anchorPrice).toBe(249);
	});
});
