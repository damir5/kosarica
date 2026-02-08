import { describe, expect, it } from "vitest";
import {
	categorizationsAgree,
	parseCategorizationResponse,
} from "./parse";

describe("parseCategorizationResponse", () => {
	it("maps amount, unit, package size, container and confidence", () => {
		const payload = {
			results: [
				{
					item_id: "itm_1",
					everyday_name: "Jar deterdžent za suđe limun",
					product_type: "deterdžent za suđe",
					brand: "Jar",
					variant: "limun",
					amount: "450ml",
					unit: "ml",
					package_size: "2x",
					container: "PET",
					search_tags: ["deterdžent", "suđe", "jar"],
					confidence: 92,
				},
			],
		};
		const parsed = parseCategorizationResponse(payload, new Set(["itm_1"]));
		const result = parsed.get("itm_1");
		expect(result).toBeDefined();
		expect(result?.everydayName).toBe("Jar deterdžent za suđe limun");
		expect(result?.productType).toBe("deterdžent za suđe");
		expect(result?.brand).toBe("Jar");
		expect(result?.variant).toBe("limun");
		expect(result?.extractedAmount).toBe(450);
		expect(result?.extractedUnit).toBe("ml");
		expect(result?.packAmount).toBe(2);
		expect(result?.containerType).toBe("pet");
		expect(result?.searchTags).toEqual(["deterdžent", "suđe", "jar"]);
		expect(result?.confidence).toBeCloseTo(0.92, 2);
	});

	it("ignores unknown item ids", () => {
		const payload = {
			results: [{ item_id: "itm_x", amount: "1l", unit: "l", confidence: 0.9 }],
		};
		const parsed = parseCategorizationResponse(payload, new Set(["itm_1"]));
		expect(parsed.size).toBe(0);
	});
});

describe("categorizationsAgree", () => {
	it("returns true for equivalent normalized outputs", () => {
		const left = {
			itemId: "itm_1",
			everydayName: "Coca-Cola Zero",
			productType: "gazirano piće",
			brand: "Coca-Cola",
			variant: "zero",
			searchTags: [],
			extractedAmount: 0.5,
			extractedUnit: "l",
			packAmount: 1,
			containerType: "pet",
			confidence: 0.9,
		};
		const right = {
			...left,
			everydayName: "coca-cola zero",
		};
		expect(categorizationsAgree(left, right)).toBe(true);
	});

	it("returns false for mismatched core fields", () => {
		const left = {
			itemId: "itm_1",
			everydayName: "Coca-Cola Zero",
			productType: "gazirano piće",
			brand: "Coca-Cola",
			variant: "zero",
			searchTags: [],
			extractedAmount: 0.5,
			extractedUnit: "l",
			packAmount: 1,
			containerType: "pet",
			confidence: 0.9,
		};
		const right = {
			...left,
			extractedAmount: 0.33,
		};
		expect(categorizationsAgree(left, right)).toBe(false);
	});
});
