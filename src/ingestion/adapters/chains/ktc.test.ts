import { describe, expect, it } from "vitest";
import { KtcAdapter } from "./ktc";

describe("KtcAdapter barcode cleanup", () => {
	it("normalizes quoted barcodes to digits", async () => {
		const adapter = new KtcAdapter();
		const csv = [
			"Naziv proizvoda;Maloprodajna cijena;Barkod",
			"Test proizvod;10,99;'3850104017537'",
		].join("\n");

		const parseResult = await adapter.parse(
			Buffer.from(csv, "utf-8"),
			"TRGOVINA-PJ06-1-20260203-071002.csv",
		);

		expect(parseResult.isOk()).toBe(true);
		const result = parseResult._unsafeUnwrap();
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.barcodes).toEqual(["3850104017537"]);
	});

	it("drops invalid barcodes and deduplicates normalized values", async () => {
		const adapter = new KtcAdapter();
		const csv = [
			"Naziv proizvoda;Maloprodajna cijena;Barkod",
			"Test proizvod;10,99;'abc', '3850104017537', 3850104017537, ''",
		].join("\n");

		const parseResult = await adapter.parse(
			Buffer.from(csv, "utf-8"),
			"TRGOVINA-PJ06-1-20260203-071002.csv",
		);

		expect(parseResult.isOk()).toBe(true);
		const result = parseResult._unsafeUnwrap();
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.barcodes).toEqual(["3850104017537"]);
		expect(
			result.warnings.filter((warning) =>
				warning.message.includes("Dropped invalid KTC barcode"),
			),
		).toHaveLength(2);
	});
});

describe("KtcAdapter store metadata extraction", () => {
	it("normalizes store name from PJ identifier when no metadata", () => {
		const adapter = new KtcAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/TRGOVINA-PJ50-1-20260203-071002.csv",
			filename: "TRGOVINA-PJ50-1-20260203-071002.csv",
			type: "csv",
		});

		expect(metadata).toEqual({
			name: "KTC PJ50",
		});
	});

	it("extracts city from discovery metadata storeName", () => {
		const adapter = new KtcAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/TRGOVINA-PJ06-1-20260212-123456.csv",
			filename: "TRGOVINA-PJ06-1-20260212-123456.csv",
			type: "csv",
			metadata: {
				storeName: "KTC Varaždin",
			},
		});

		expect(metadata).toEqual({
			name: "KTC Varaždin",
			city: "Varaždin",
		});
	});

	it("extracts city from storeName with comma separator", () => {
		const adapter = new KtcAdapter();
		const metadata = adapter.extractStoreMetadata({
			url: "https://example.test/TRGOVINA-PJ07-1-20260212-123456.csv",
			filename: "TRGOVINA-PJ07-1-20260212-123456.csv",
			type: "csv",
			metadata: {
				storeName: "KTC, Zagreb",
			},
		});

		expect(metadata).toEqual({
			name: "KTC Zagreb",
			city: "Zagreb",
		});
	});
});
