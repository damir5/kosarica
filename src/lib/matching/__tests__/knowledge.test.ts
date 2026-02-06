import { describe, expect, test } from "vitest";
import {
	getProductTypeFromCanonicalKey,
	matchesEquivalencePattern,
} from "@/lib/matching/knowledge";

describe("knowledge matching helpers", () => {
	test("parses product type from canonical key", () => {
		expect(getProductTypeFromCanonicalKey("milk-fresh-3.2-1.75l")).toBe(
			"milk",
		);
		expect(getProductTypeFromCanonicalKey(null)).toBeNull();
	});

	test("matches equivalence by normalized text", () => {
		expect(
			matchesEquivalencePattern(
				"Z bregov svježe mlijeko 3,2% 1,75 l PET",
				"MLIJEKO 3,2% 1,75 L",
			),
		).toBe(true);
	});
});
