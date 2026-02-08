import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
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

	it("extracts metadata from another real filename pattern", () => {
		const adapter = new IntersparAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/supermarket_osijek_svilajska_ulica_35b_87171_esp_os_svilajska_0281_20260206_0330.csv",
			filename:
				"supermarket_osijek_svilajska_ulica_35b_87171_esp_os_svilajska_0281_20260206_0330.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "Interspar osijek",
			address: "svilajska ulica 35b",
			city: "osijek",
		});
	});

	it("parses cp1250 csv without replacement characters", async () => {
		const adapter = new IntersparAdapter();
		const csv =
			"naziv;šifra;marka;neto količina;jedinica mjere;MPC (EUR);cijena za jedinicu mjere (EUR);MPC za vrijeme posebnog oblika prodaje (EUR);Najniža cijena u posljednjih 30 dana (EUR);sidrena cijena na 2.5.2025. (EUR);barkod;kategorija proizvoda\n" +
			"ŠAMP.SCHAUMA 7 LJEK.TRA.400 ml;12345;Schauma;0.4;l;3,17;7,93;;;;3838824086750;Kozmetika";
		const content = iconv.encode(csv, "windows-1250");

		const parsed = await adapter.parse(
			content,
			"hipermarket_zagreb_test_0001_20260208_0330.csv",
		);

		expect(parsed.isOk()).toBe(true);
		if (parsed.isErr()) {
			throw new Error(parsed.error.message);
		}

		expect(parsed.value.validRows).toBe(1);
		expect(parsed.value.rows[0]?.name).toBe("ŠAMP.SCHAUMA 7 LJEK.TRA.400 ml");
		expect(parsed.value.rows[0]?.name.includes("�")).toBe(false);
		expect(parsed.value.rows[0]?.barcodes).toEqual(["3838824086750"]);
	});
});
