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
