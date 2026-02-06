import { beforeAll, describe, expect, test } from "vitest";
import { extractProductAttributes } from "@/lib/knowledge/extractor";
import { loadCatalog } from "@/lib/knowledge/loader";
import type { KnowledgeCatalog } from "@/lib/knowledge/types";

let catalog: KnowledgeCatalog;

beforeAll(async () => {
	catalog = await loadCatalog();
});

describe("knowledge extractor", () => {
	test("extracts dairy attributes and canonical key", () => {
		const extracted = extractProductAttributes(
			"MLIJEKO SV.3,2% Z BREG.1,75 L",
			"Z BREG.",
			"dairy",
			catalog,
		);

		expect(extracted.productType).toBe("milk-fresh");
		expect(extracted.attributes.fatPercent).toBeCloseTo(3.2, 1);
		expect(extracted.attributes.volumeValue).toBeCloseTo(1.75, 2);
		expect(extracted.attributes.volumeUnit).toBe("l");
		expect(extracted.canonicalKey).toBe("milk-fresh-3.2-1.75l");
	});

	test("extracts staple count from eggs", () => {
		const extracted = extractProductAttributes(
			"Jaja razred M 10 kom",
			null,
			"staples",
			catalog,
		);
		expect(extracted.productType).toBe("eggs");
		expect(extracted.attributes.count).toBe(10);
		expect(extracted.canonicalKey).toBe("eggs-m-10kom");
	});
});
