import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { EurospinAdapter } from "./eurospin";

describe("EurospinAdapter store identifier extraction", () => {
	it("extracts 6-digit store code from prodavaonica filename", () => {
		const adapter = new EurospinAdapter();
		const identifier = adapter.extractStoreIdentifier({
			url: "https://example.test/prodavaonica-310002-I_Štefanovecki_zavoj_12-Zagreb_Dubec-10360-310002010226-01.02.2026-7.30.xml",
			filename:
				"prodavaonica-310002-I_Štefanovecki_zavoj_12-Zagreb_Dubec-10360-310002010226-01.02.2026-7.30.xml",
			type: "xml",
		});

		expect(identifier).toEqual({
			type: "eurospin_store_code",
			value: "310002",
		});
	});

	it("extracts 6-digit store code from diskontna_prodavaonica filename", () => {
		const adapter = new EurospinAdapter();
		const identifier = adapter.extractStoreIdentifier({
			url: "https://example.test/diskontna_prodavaonica-310003-Zagreb-10000-310003311025-31.10.2025-7.30.csv",
			filename:
				"diskontna_prodavaonica-310003-Zagreb-10000-310003311025-31.10.2025-7.30.csv",
			type: "csv",
		});

		expect(identifier).toEqual({
			type: "eurospin_store_code",
			value: "310003",
		});
	});

	it("returns consistent identifier for same store with different filename patterns", () => {
		const adapter = new EurospinAdapter();

		const id1 = adapter.extractStoreIdentifier({
			url: "",
			filename:
				"prodavaonica-310002-I_Štefanovecki_zavoj_12-Zagreb_Dubec-10360-310002010226-01.02.2026-7.30.xml",
			type: "xml",
		});

		const id2 = adapter.extractStoreIdentifier({
			url: "",
			filename:
				"diskontna_prodavaonica-310002-Other_Street_5-Split-21000-310002150126-15.01.2026-8.00.csv",
			type: "csv",
		});

		expect(id1?.value).toBe(id2?.value);
		expect(id1?.value).toBe("310002");
	});
});

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
			"diskontna_prodavaonica-310002-I_Štefanovecki_zavoj_12-Zagreb-10000-310002311025-31.10.2025-7.30.csv",
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
