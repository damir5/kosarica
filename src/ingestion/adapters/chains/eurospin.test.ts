import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
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

	it("parses cp1250 csv without replacement characters", async () => {
		const adapter = new EurospinAdapter();
		const csv =
			'"NAZIV_PROIZVODA";"ŠIFRA_PROIZVODA";"MARKA_PROIZVODA";"NETO_KOLIČINA";"JEDINICA_MJERE";"MALOPROD.CIJENA(EUR)";"MPC_POSEB.OBLIK_PROD";"BARKOD";"KATEGORIJA_PROIZVODA"\n' +
			'"ŠTAPIĆI ČOKOLADA";"12345";"Eurospin";"100";"g";"1,49";"";"3850000000000";"Slatkiši"';
		const content = iconv.encode(csv, "windows-1250");

		const parsed = await adapter.parse(
			content,
			'diskontna_prodavaonica-310002-I_Štefanovecki_zavoj_12-Zagreb-10000-310002311025-31.10.2025-7.30.csv',
		);

		expect(parsed.isOk()).toBe(true);
		if (parsed.isErr()) {
			throw new Error(parsed.error.message);
		}

		expect(parsed.value.validRows).toBe(1);
		expect(parsed.value.rows[0]?.name).toBe("ŠTAPIĆI ČOKOLADA");
		expect(parsed.value.rows[0]?.name.includes("�")).toBe(false);
		expect(parsed.value.rows[0]?.barcodes).toEqual(["3850000000000"]);
	});
});
