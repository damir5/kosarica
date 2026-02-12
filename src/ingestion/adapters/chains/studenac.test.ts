import { describe, expect, it } from "vitest";
import { StudenacAdapter } from "./studenac";

describe("StudenacAdapter", () => {
	it("uses akcija price when regular price is empty", async () => {
		const adapter = new StudenacAdapter();
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Proizvodi>
  <ProdajniObjekt>
    <Proizvodi>
      <Proizvod>
        <NazivProizvoda>Regular Product</NazivProizvoda>
        <SifraProizvoda>1001</SifraProizvoda>
        <MaloprodajnaCijena>2.50</MaloprodajnaCijena>
        <MaloprodajnaCijenaAkcija/>
        <Barkod>3850000000001</Barkod>
      </Proizvod>
      <Proizvod>
        <NazivProizvoda>Akcija Only</NazivProizvoda>
        <SifraProizvoda>1002</SifraProizvoda>
        <MaloprodajnaCijena/>
        <MaloprodajnaCijenaAkcija>1.89</MaloprodajnaCijenaAkcija>
        <Barkod>3850000000002</Barkod>
      </Proizvod>
      <Proizvod>
        <NazivProizvoda>No Price</NazivProizvoda>
        <SifraProizvoda>1003</SifraProizvoda>
        <MaloprodajnaCijena/>
        <MaloprodajnaCijenaAkcija/>
        <Barkod>3850000000003</Barkod>
      </Proizvod>
    </Proizvodi>
  </ProdajniObjekt>
</Proizvodi>`;

		const parseResult = await adapter.parse(
			Buffer.from(xml, "utf-8"),
			"SUPERMARKET-Test-T123-265-2026-02-03.xml",
		);

		expect(parseResult.isOk()).toBe(true);
		const result = parseResult._unsafeUnwrap();
		expect(result.totalRows).toBe(3);
		expect(result.validRows).toBe(3);
		expect(result.errors).toHaveLength(0);

		const fallbackRow = result.rows.find((row) => row.externalId === "1002");
		expect(fallbackRow).toBeDefined();
		expect(fallbackRow?.storeIdentifier).toBe("123");
		expect(fallbackRow?.price).toBe(189);
		expect(fallbackRow?.priceStatus).toBe("available");
		expect(fallbackRow?.discountPrice).toBeUndefined();

		const missingPriceRow = result.rows.find(
			(row) => row.externalId === "1003",
		);
		expect(missingPriceRow).toBeDefined();
		expect(missingPriceRow?.price).toBeNull();
		expect(missingPriceRow?.priceStatus).toBe("unavailable");
		expect(missingPriceRow?.priceUnavailableReason).toBe("missing");
	});

	it("keeps akcija as discount when regular price exists", async () => {
		const adapter = new StudenacAdapter();
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Proizvodi>
  <ProdajniObjekt>
    <Proizvodi>
      <Proizvod>
        <NazivProizvoda>Regular + Discount</NazivProizvoda>
        <SifraProizvoda>2001</SifraProizvoda>
        <MaloprodajnaCijena>5.00</MaloprodajnaCijena>
        <MaloprodajnaCijenaAkcija>4.00</MaloprodajnaCijenaAkcija>
        <Barkod>3850000000004</Barkod>
      </Proizvod>
    </Proizvodi>
  </ProdajniObjekt>
</Proizvodi>`;

		const parseResult = await adapter.parse(
			Buffer.from(xml, "utf-8"),
			"SUPERMARKET-Test-T321-265-2026-02-03.xml",
		);

		expect(parseResult.isOk()).toBe(true);
		const result = parseResult._unsafeUnwrap();
		expect(result.totalRows).toBe(1);
		expect(result.validRows).toBe(1);
		expect(result.errors).toHaveLength(0);
		expect(result.rows[0]?.price).toBe(500);
		expect(result.rows[0]?.discountPrice).toBe(400);
		expect(result.rows[0]?.storeIdentifier).toBe("321");
	});
});

describe("StudenacAdapter store metadata extraction", () => {
	it("extracts full multi-word city from filename metadata", () => {
		const adapter = new StudenacAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/SUPERMARKET-Ul.I.Kukuljevića_Sakcinskog_12_SVETI_KRIŽ_ZAČRETJE-T1350-263-2026-01-26-07-00-13-295460.xml",
			filename:
				"SUPERMARKET-Ul.I.Kukuljevića_Sakcinskog_12_SVETI_KRIŽ_ZAČRETJE-T1350-263-2026-01-26-07-00-13-295460.xml",
			type: "xml",
		});

		expect(metadata).toEqual({
			name: "Studenac SVETI KRIŽ ZAČRETJE",
			address: "Ul.I.Kukuljevića Sakcinskog 12",
			city: "SVETI KRIŽ ZAČRETJE",
		});
	});

	it("extracts city from simple filename with single city word", () => {
		const adapter = new StudenacAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/SUPERMARKET-Put_Gaja_17_IMOTSKI-T053-263-2026-02-01-07-00-00-080733.xml",
			filename:
				"SUPERMARKET-Put_Gaja_17_IMOTSKI-T053-263-2026-02-01-07-00-00-080733.xml",
			type: "xml",
		});

		expect(metadata).toEqual({
			name: "Studenac IMOTSKI",
			address: "Put Gaja 17",
			city: "IMOTSKI",
		});
	});

	it("extracts street and city from filename with street number", () => {
		const adapter = new StudenacAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/SUPERMARKET-Vukovarska_26_DUBROVNIK-T840-263-2026-02-01-07-00-07-828651.xml",
			filename:
				"SUPERMARKET-Vukovarska_26_DUBROVNIK-T840-263-2026-02-01-07-00-07-828651.xml",
			type: "xml",
		});

		expect(metadata).toEqual({
			name: "Studenac DUBROVNIK",
			address: "Vukovarska 26",
			city: "DUBROVNIK",
		});
	});

	it("extracts multi-word city like CISTA PROVO", () => {
		const adapter = new StudenacAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/SUPERMARKET-Domovinskog_rata_12A_CISTA_PROVO-T335-263-2026-02-01-07-00-03-589848.xml",
			filename:
				"SUPERMARKET-Domovinskog_rata_12A_CISTA_PROVO-T335-263-2026-02-01-07-00-03-589848.xml",
			type: "xml",
		});

		expect(metadata).toEqual({
			name: "Studenac CISTA PROVO",
			address: "Domovinskog rata 12A",
			city: "CISTA PROVO",
		});
	});

	it("falls back to store code when pattern not matched", () => {
		const adapter = new StudenacAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/Store_T789-265-2026-02-03.xml",
			filename: "Store_T789-265-2026-02-03.xml",
			type: "xml",
		});

		expect(metadata?.name).toMatch(/^Studenac/);
	});
});
