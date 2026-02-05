import { describe, expect, it } from "vitest";
import { KtcAdapter } from "./ktc";

describe("KtcAdapter barcode cleanup", () => {
	it("normalizes quoted barcodes to digits", async () => {
		const adapter = new KtcAdapter();
		const csv = [
			"Naziv proizvoda;Maloprodajna cijena;Barkod",
			"Test proizvod;10,99;'3850104017537'",
		].join("\n");

		const result = await adapter.parse(
			Buffer.from(csv, "utf-8"),
			"TRGOVINA-PJ06-1-20260203-071002.csv",
		);

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.barcodes).toEqual(["3850104017537"]);
	});

	it("drops invalid barcodes and deduplicates normalized values", async () => {
		const adapter = new KtcAdapter();
		const csv = [
			"Naziv proizvoda;Maloprodajna cijena;Barkod",
			"Test proizvod;10,99;'abc', '3850104017537', 3850104017537, ''",
		].join("\n");

		const result = await adapter.parse(
			Buffer.from(csv, "utf-8"),
			"TRGOVINA-PJ06-1-20260203-071002.csv",
		);

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.barcodes).toEqual(["3850104017537"]);
		expect(
			result.warnings.filter((warning) =>
				warning.message.includes("Dropped invalid KTC barcode"),
			),
		).toHaveLength(2);
	});
});
