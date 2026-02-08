import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { retailerItems } from "../schema";

describe("retailerItems schema", () => {
	describe("table structure", () => {
		it("should have all expected columns", () => {
			const columns = getTableColumns(retailerItems);
			const columnNames = Object.keys(columns);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("isPrimary");
			expect(columnNames).toContain("name");
			expect(columnNames).toContain("externalId");
			expect(columnNames).toContain("chainSlug");
		});

		it("should not expose removed legacy columns", () => {
			const columns = getTableColumns(retailerItems);
			const columnNames = Object.keys(columns);

			expect(columnNames).not.toContain("retailerItemId");
			expect(columnNames).not.toContain("barcode");
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

		it("should have archive_id index", () => {
			const config = getTableConfig(retailerItems);
			const indexNames = config.indexes.map((idx) => idx.config.name);

			expect(indexNames).toContain("idx_retailer_items_archive_id");
		});
	});
});
