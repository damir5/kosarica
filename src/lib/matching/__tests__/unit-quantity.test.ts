import { describe, expect, it } from "vitest";
import { checkUnitQuantityMismatch } from "../index";

describe("checkUnitQuantityMismatch", () => {
	it("flags unit type mismatch (kg vs l)", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
				{ normalizedUnit: "l", normalizedQuantity: 1 },
			),
		).toBe("trgm_unit_type_mismatch");
	});

	it("flags quantity ratio > 2x (1L vs 6L)", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "l", normalizedQuantity: 1 },
				{ normalizedUnit: "l", normalizedQuantity: 6 },
			),
		).toBe("trgm_quantity_mismatch");
	});

	it("flags quantity ratio < 0.5x (6L vs 1L)", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "l", normalizedQuantity: 6 },
				{ normalizedUnit: "l", normalizedQuantity: 1 },
			),
		).toBe("trgm_quantity_mismatch");
	});

	it("does not flag at 2x boundary (0.5kg vs 1kg)", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "kg", normalizedQuantity: 0.5 },
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
			),
		).toBe("");
	});

	it("does not flag at exactly 2x (2kg vs 1kg)", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "kg", normalizedQuantity: 2 },
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
			),
		).toBe("");
	});

	it("does not flag when item unit is null", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: null, normalizedQuantity: 1 },
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
			),
		).toBe("");
	});

	it("does not flag when candidate unit is null", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
				{ normalizedUnit: null, normalizedQuantity: 1 },
			),
		).toBe("");
	});

	it("does not flag when item quantity is null", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "kg", normalizedQuantity: null },
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
			),
		).toBe("");
	});

	it("does not flag when candidate quantity is null", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
				{ normalizedUnit: "kg", normalizedQuantity: null },
			),
		).toBe("");
	});

	it("does not flag same unit and same quantity", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "l", normalizedQuantity: 0.5 },
				{ normalizedUnit: "l", normalizedQuantity: 0.5 },
			),
		).toBe("");
	});

	it("does not flag when item quantity is zero", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "kg", normalizedQuantity: 0 },
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
			),
		).toBe("");
	});

	it("does not flag when candidate quantity is zero", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: "kg", normalizedQuantity: 1 },
				{ normalizedUnit: "kg", normalizedQuantity: 0 },
			),
		).toBe("");
	});

	it("does not flag when both units are null", () => {
		expect(
			checkUnitQuantityMismatch(
				{ normalizedUnit: null, normalizedQuantity: null },
				{ normalizedUnit: null, normalizedQuantity: null },
			),
		).toBe("");
	});
});
