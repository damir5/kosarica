/**
 * Tests for retailer_items schema changes
 * Phase 1: Schema Fixes to enable ingestion
 */

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
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

	describe("indexes", () => {
		it("should have unique index on chain_slug and external_id", () => {
			const config = getTableConfig(retailerItems);
			const indexNames = config.indexes.map((idx) => idx.config.name);

			expect(indexNames).toContain(
				"retailer_items_chain_slug_external_id_unique",
			);
		});

		it("should have chain_slug_external_id index marked as unique", () => {
			const config = getTableConfig(retailerItems);
			const chainExternalIdIndex = config.indexes.find(
				(idx) =>
					idx.config.name === "retailer_items_chain_slug_external_id_unique",
			);

			expect(chainExternalIdIndex).toBeDefined();
			expect(chainExternalIdIndex?.config.unique).toBe(true);
		});

		it("should have chain_slug_external_id index with correct columns", () => {
			const config = getTableConfig(retailerItems);
			const chainExternalIdIndex = config.indexes.find(
				(idx) =>
					idx.config.name === "retailer_items_chain_slug_external_id_unique",
			);

			expect(chainExternalIdIndex).toBeDefined();
			// Check that the index has 2 columns (chain_slug and external_id)
			expect(chainExternalIdIndex?.config.columns.length).toBe(2);
		});

		it("should have barcode index", () => {
			const config = getTableConfig(retailerItems);
			const indexNames = config.indexes.map((idx) => idx.config.name);

			expect(indexNames).toContain("retailer_item_barcodes_barcode_idx");
		});

		it("should have archive_id index", () => {
			const config = getTableConfig(retailerItems);
			const indexNames = config.indexes.map((idx) => idx.config.name);

			expect(indexNames).toContain("idx_retailer_items_archive_id");
		});
	});
});
