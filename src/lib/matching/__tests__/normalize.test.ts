import { describe, expect, it } from "vitest";
import {
	calculateUnitPriceCents,
	computeNameHash,
	confidenceRank,
	normalizeProductName,
	normalizeWhitespace,
	parseUnit,
	removeDiacritics,
} from "../normalize";

describe("removeDiacritics", () => {
	it("removes Croatian diacritics", () => {
		expect(removeDiacritics("čćžšđ")).toBe("cczsdj");
		expect(removeDiacritics("ČĆŽŠĐ")).toBe("CCZSDj");
	});

	it("handles mixed text", () => {
		expect(removeDiacritics("Mlijeko Čokolada")).toBe("Mlijeko Cokolada");
	});

	it("passes through ASCII unchanged", () => {
		expect(removeDiacritics("hello world")).toBe("hello world");
	});
});

describe("normalizeWhitespace", () => {
	it("trims and collapses whitespace", () => {
		expect(normalizeWhitespace("  hello   world  ")).toBe("hello world");
	});
});

describe("normalizeProductName", () => {
	it("lowercases, removes diacritics, strips punctuation", () => {
		expect(normalizeProductName("Čokolada Milk 500g!")).toBe(
			"cokolada milk 500g",
		);
	});

	it("collapses whitespace", () => {
		expect(normalizeProductName("Milk  1L")).toBe("milk 1l");
	});

	it("strips parentheses and special chars", () => {
		expect(normalizeProductName("Kruh (bijeli) - 1kg")).toBe("kruh bijeli 1kg");
	});
});

describe("computeNameHash", () => {
	it("produces deterministic hashes", () => {
		const h1 = computeNameHash("Mlijeko 1L");
		const h2 = computeNameHash("Mlijeko 1L");
		expect(h1).toBe(h2);
	});

	it("normalizes before hashing", () => {
		const h1 = computeNameHash("Čokolada 500g");
		const h2 = computeNameHash("cokolada 500g");
		expect(h1).toBe(h2);
	});

	it("treats different names differently", () => {
		const h1 = computeNameHash("Mlijeko");
		const h2 = computeNameHash("Jogurt");
		expect(h1).not.toBe(h2);
	});

	it("returns null for empty string", () => {
		expect(computeNameHash("")).toBeNull();
	});

	it("returns null for whitespace-only string", () => {
		expect(computeNameHash("   ")).toBeNull();
	});

	it("returns null for punctuation-only string", () => {
		expect(computeNameHash("---")).toBeNull();
	});
});

describe("confidenceRank", () => {
	it("returns correct ranks", () => {
		expect(confidenceRank("verified")).toBe(5);
		expect(confidenceRank("manual")).toBe(4);
		expect(confidenceRank("ai")).toBe(3);
		expect(confidenceRank("barcode")).toBe(2);
		expect(confidenceRank("heuristic")).toBe(2);
		expect(confidenceRank("auto")).toBe(1);
	});

	it("returns 0 for null/unknown", () => {
		expect(confidenceRank(null)).toBe(0);
		expect(confidenceRank(undefined)).toBe(0);
		expect(confidenceRank("unknown_type")).toBe(0);
	});
});

describe("parseUnit", () => {
	describe("explicit rawQty + rawUnit", () => {
		it("parses kg", () => {
			expect(parseUnit("kg", "1.5", "Product")).toEqual({
				unit: "kg",
				quantity: 1.5,
			});
		});

		it("parses grams → kg", () => {
			expect(parseUnit("g", "500", "Product")).toEqual({
				unit: "kg",
				quantity: 0.5,
			});
		});

		it("parses liters", () => {
			expect(parseUnit("l", "2", "Product")).toEqual({
				unit: "l",
				quantity: 2,
			});
		});

		it("parses ml → liters", () => {
			expect(parseUnit("ml", "750", "Product")).toEqual({
				unit: "l",
				quantity: 0.75,
			});
		});

		it("parses kom/pcs", () => {
			expect(parseUnit("KOM", "1", "Product")).toEqual({
				unit: "kom",
				quantity: 1,
			});
			expect(parseUnit("pcs", "6", "Product")).toEqual({
				unit: "kom",
				quantity: 6,
			});
		});

		it("parses Croatian decimal (comma)", () => {
			expect(parseUnit("kg", "0,500", "Product")).toEqual({
				unit: "kg",
				quantity: 0.5,
			});
		});

		it("handles Croatian thousand separator (dot+comma)", () => {
			expect(parseUnit("g", "1.500,00", "Product")).toEqual({
				unit: "kg",
				quantity: 1.5,
			});
		});

		it("handles rawQty with unit suffix", () => {
			expect(parseUnit("KG", "1.00 KG", "Product")).toEqual({
				unit: "kg",
				quantity: 1,
			});
		});

		it("handles rawQty with grams and unit suffix", () => {
			expect(parseUnit("G", "1000 G", "Product")).toEqual({
				unit: "kg",
				quantity: 1,
			});
		});
	});

	describe("embedded in rawUnit", () => {
		it("parses 500g", () => {
			expect(parseUnit("500g", null, "Product")).toEqual({
				unit: "kg",
				quantity: 0.5,
			});
		});

		it("parses 1.5l", () => {
			expect(parseUnit("1.5l", null, "Product")).toEqual({
				unit: "l",
				quantity: 1.5,
			});
		});

		it("parses multipack: 6x330ml", () => {
			expect(parseUnit("6x330ml", null, "Product")).toEqual({
				unit: "l",
				quantity: 1.98,
			});
		});

		it("parses multipack with spaces: 6 x 330 ml", () => {
			expect(parseUnit("6 x 330 ml", null, "Product")).toEqual({
				unit: "l",
				quantity: 1.98,
			});
		});
	});

	describe("embedded in rawQty", () => {
		it("parses 1.00 kg from rawQty", () => {
			expect(parseUnit(null, "1.00 kg", "Product")).toEqual({
				unit: "kg",
				quantity: 1,
			});
		});

		it("parses 0,500 KG from rawQty (Croatian decimal)", () => {
			expect(parseUnit(null, "0,500 KG", "Product")).toEqual({
				unit: "kg",
				quantity: 0.5,
			});
		});
	});

	describe("extract from product name", () => {
		it("extracts from name", () => {
			expect(parseUnit(null, null, "Mlijeko 1l")).toEqual({
				unit: "l",
				quantity: 1,
			});
		});

		it("extracts grams from name", () => {
			expect(parseUnit(null, null, "Čokolada 100g")).toEqual({
				unit: "kg",
				quantity: 0.1,
			});
		});

		it("extracts multipack from name", () => {
			expect(parseUnit(null, null, "Pivo 6x500ml")).toEqual({
				unit: "l",
				quantity: 3,
			});
		});

		it("extracts multipack with spaces", () => {
			expect(parseUnit(null, null, "Voda 6 x 1.5 l")).toEqual({
				unit: "l",
				quantity: 9,
			});
		});
	});

	describe("edge cases", () => {
		it("returns null when nothing parseable", () => {
			expect(parseUnit(null, null, "Just a name")).toBeNull();
		});

		it("handles unit-only field: kom → 1 piece", () => {
			expect(parseUnit("kom", null, "Product")).toEqual({
				unit: "kom",
				quantity: 1,
			});
		});

		it("handles 1komad", () => {
			expect(parseUnit("1komad", null, "Product")).toEqual({
				unit: "kom",
				quantity: 1,
			});
		});
	});
});

describe("calculateUnitPriceCents", () => {
	it("calculates price per kg", () => {
		// 500g at 1000 cents → 2000 cents per kg
		expect(calculateUnitPriceCents(1000, { unit: "kg", quantity: 0.5 })).toBe(
			2000,
		);
	});

	it("calculates price per liter", () => {
		// 330ml at 500 cents → ~1515 cents per liter
		expect(calculateUnitPriceCents(500, { unit: "l", quantity: 0.33 })).toBe(
			1515,
		);
	});

	it("handles piece pricing", () => {
		// 6-pack at 3000 cents → 500 cents per piece
		expect(calculateUnitPriceCents(3000, { unit: "kom", quantity: 6 })).toBe(
			500,
		);
	});

	it("returns 0 for zero quantity", () => {
		expect(calculateUnitPriceCents(1000, { unit: "kg", quantity: 0 })).toBe(0);
	});
});
