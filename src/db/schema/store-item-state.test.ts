/**
 * Tests for store_item_state schema changes
 * Phase 1: Schema Fixes to enable ingestion
 */

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { storeItemState } from "../schema";

describe("storeItemState schema", () => {
	describe("table structure", () => {
		it("should have all expected columns", () => {
			const columns = getTableColumns(storeItemState);
			const columnNames = Object.keys(columns);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("storeId");
			expect(columnNames).toContain("retailerItemId");
			expect(columnNames).toContain("currentPrice");
			expect(columnNames).toContain("previousPrice");
			expect(columnNames).toContain("discountPrice");
			expect(columnNames).toContain("inStock");
			expect(columnNames).toContain("lastSeenAt");
			expect(columnNames).toContain("updatedAt");
		});

		it("should have id as primary key", () => {
			const columns = getTableColumns(storeItemState);
			expect(columns.id.primary).toBe(true);
		});

		it("should have storeId as not null", () => {
			const columns = getTableColumns(storeItemState);
			expect(columns.storeId.notNull).toBe(true);
		});

		it("should have retailerItemId as not null", () => {
			const columns = getTableColumns(storeItemState);
			expect(columns.retailerItemId.notNull).toBe(true);
		});
	});

	describe("indexes", () => {
		it("should have unique index on store_id and retailer_item_id", () => {
			const config = getTableConfig(storeItemState);
			const indexNames = config.indexes.map((idx) => idx.config.name);

			expect(indexNames).toContain("store_item_state_store_retailer_unique");
		});

		it("should have store_retailer index marked as unique", () => {
			const config = getTableConfig(storeItemState);
			const storeRetailerIndex = config.indexes.find(
				(idx) => idx.config.name === "store_item_state_store_retailer_unique",
			);

			expect(storeRetailerIndex).toBeDefined();
			expect(storeRetailerIndex?.config.unique).toBe(true);
		});

		it("should have store_retailer unique index with correct 2 columns", () => {
			const config = getTableConfig(storeItemState);
			const storeRetailerIndex = config.indexes.find(
				(idx) => idx.config.name === "store_item_state_store_retailer_unique",
			);

			expect(storeRetailerIndex).toBeDefined();
			// Check that the index has 2 columns (store_id and retailer_item_id)
			expect(storeRetailerIndex?.config.columns.length).toBe(2);
		});

		it("should have last_seen index", () => {
			const config = getTableConfig(storeItemState);
			const indexNames = config.indexes.map((idx) => idx.config.name);

			expect(indexNames).toContain("store_item_state_last_seen_idx");
		});

		it("should have price_signature index", () => {
			const config = getTableConfig(storeItemState);
			const indexNames = config.indexes.map((idx) => idx.config.name);

			expect(indexNames).toContain("store_item_state_price_signature_idx");
		});
	});
});
