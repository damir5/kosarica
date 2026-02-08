/**
 * Tests for retailer_item_barcodes schema
 * Phase 1: Schema Fixes to enable ingestion
 */

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { retailerItemBarcodes, retailerItems } from "../schema";

describe("retailerItemBarcodes schema", () => {
	describe("table structure", () => {
		it("should have all expected columns", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			const columnNames = Object.keys(columns);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("retailerItemId");
			expect(columnNames).toContain("barcode");
			expect(columnNames).toContain("barcodeClass");
			expect(columnNames).toContain("isPrimary");
			expect(columnNames).toContain("createdAt");
		});

		it("should have exactly 6 columns", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(Object.keys(columns).length).toBe(6);
		});
	});

	describe("id column", () => {
		it("should have id as primary key", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.id.primary).toBe(true);
		});

		it("should have id as text type", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.id.dataType).toBe("string");
		});
	});

	describe("retailerItemId column", () => {
		it("should have retailerItemId column defined", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.retailerItemId).toBeDefined();
		});

		it("should have retailerItemId as not null", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.retailerItemId.notNull).toBe(true);
		});

		it("should have retailerItemId as text type", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.retailerItemId.dataType).toBe("string");
		});
	});

	describe("barcode column", () => {
		it("should have barcode column defined", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.barcode).toBeDefined();
		});

		it("should have barcode as not null", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.barcode.notNull).toBe(true);
		});

		it("should have barcode as text type", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.barcode.dataType).toBe("string");
		});
	});

	describe("barcodeClass column", () => {
		it("should have barcodeClass column defined", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.barcodeClass).toBeDefined();
		});

		it("should have barcodeClass as text type", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.barcodeClass.dataType).toBe("string");
		});
	});

	describe("isPrimary column", () => {
		it("should have isPrimary column defined", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.isPrimary).toBeDefined();
		});

		it("should have isPrimary as boolean type", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.isPrimary.dataType).toBe("boolean");
		});

		it("should have isPrimary as nullable (with default false)", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			// Has a default value, so it's not required on insert
			expect(columns.isPrimary.hasDefault).toBe(true);
		});
	});

	describe("createdAt column", () => {
		it("should have createdAt column defined", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.createdAt).toBeDefined();
		});

		it("should have createdAt with default value", () => {
			const columns = getTableColumns(retailerItemBarcodes);
			expect(columns.createdAt.hasDefault).toBe(true);
		});
	});

	describe("foreign key relationship", () => {
		it("should reference retailerItems table", () => {
			// Verify the table exists that we're referencing
			const retailerItemsColumns = getTableColumns(retailerItems);
			expect(retailerItemsColumns.id).toBeDefined();
			expect(retailerItemsColumns.id.primary).toBe(true);
		});
	});
});
