import { describe, expect, test } from "vitest";
import { validateCatalog } from "@/lib/knowledge/validator";

describe("knowledge validator", () => {
	test("validates the in-repo knowledge catalog", async () => {
		const result = await validateCatalog();
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});
