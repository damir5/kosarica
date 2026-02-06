import { beforeAll, describe, expect, test } from "vitest";
import {
	areSameBrandFamily,
	resolveBrand,
} from "@/lib/knowledge/brand-resolver";
import { loadCatalog } from "@/lib/knowledge/loader";
import type { KnowledgeCatalog } from "@/lib/knowledge/types";

let catalog: KnowledgeCatalog;

beforeAll(async () => {
	catalog = await loadCatalog();
});

describe("brand resolver", () => {
	test("resolves sub-brand and parent family", () => {
		const resolved = resolveBrand("Z BREG.", catalog);
		expect(resolved).not.toBeNull();
		expect(resolved?.brandId).toBe("z-bregov");
		expect(resolved?.parentBrand).toBe("vindija");
	});

	test("resolves private label metadata", () => {
		const resolved = resolveBrand("Milbona", catalog);
		expect(resolved).not.toBeNull();
		expect(resolved?.isPrivateLabel).toBe(true);
		expect(resolved?.chain).toBe("lidl");
	});

	test("compares same family correctly", () => {
		expect(areSameBrandFamily("z bregov", "vindija", catalog)).toBe(true);
		expect(areSameBrandFamily("dukat", "vindija", catalog)).toBe(false);
	});
});
