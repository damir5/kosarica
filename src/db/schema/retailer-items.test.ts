/**
 * Tests for retailer_items schema changes
 * Phase 1: Schema Fixes to enable ingestion
 */

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { retailerItems } from "../schema";

describe("retailerItems schema", () => {
	describe("barcode column", () => {
		it("should have barcode column defined", () => {
			const columns = getTableColumns(retailerItems);
			expect(columns.barcode).toBeDefined();
		});

		it("should have barcode column as nullable (legacy column)", () => {
			const columns = getTableColumns(retailerItems);
			// In Drizzle, notNull property indicates if the column is NOT NULL
			// When notNull is false/undefined, the column accepts NULL values
			expect(columns.barcode.notNull).toBe(false);
		});

		it("should have barcode as text type", () => {
			const columns = getTableColumns(retailerItems);
			expect(columns.barcode.dataType).toBe("string");
		});
	});

	describe("retailerItemId column", () => {
		it("should have retailerItemId column defined", () => {
			const columns = getTableColumns(retailerItems);
			expect(columns.retailerItemId).toBeDefined();
		});

		it("should have retailerItemId column as nullable (legacy column)", () => {
			const columns = getTableColumns(retailerItems);
			// In Drizzle, notNull property indicates if the column is NOT NULL
			// When notNull is false/undefined, the column accepts NULL values
			expect(columns.retailerItemId.notNull).toBe(false);
		});

		it("should have retailerItemId as integer type", () => {
			const columns = getTableColumns(retailerItems);
			expect(columns.retailerItemId.dataType).toBe("number");
		});
	});

	describe("table structure", () => {
		it("should have all expected columns", () => {
			const columns = getTableColumns(retailerItems);
			const columnNames = Object.keys(columns);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("retailerItemId");
			expect(columnNames).toContain("barcode");
			expect(columnNames).toContain("isPrimary");
			expect(columnNames).toContain("name");
			expect(columnNames).toContain("externalId");
			expect(columnNames).toContain("chainSlug");
		});

		it("should have id as primary key", () => {
			const columns = getTableColumns(retailerItems);
			expect(columns.id.primary).toBe(true);
		});

		it("should have name as not null", () => {
			const columns = getTableColumns(retailerItems);
			expect(columns.name.notNull).toBe(true);
		});
	});
});
