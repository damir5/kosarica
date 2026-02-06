import { describe, expect, test } from "vitest";
import { loadCatalog } from "@/lib/knowledge/loader";

describe("knowledge loader", () => {
	test("loads catalog and key indexes", async () => {
		const catalog = await loadCatalog();
		expect(catalog.brandFiles.length).toBeGreaterThan(0);
		expect(catalog.productsByCanonicalKey.has("milk-fresh-3.2-1.75l")).toBe(true);
		expect(catalog.extractionByCategory.has("dairy")).toBe(true);
		expect(catalog.chains.has("konzum")).toBe(true);
	});
});
