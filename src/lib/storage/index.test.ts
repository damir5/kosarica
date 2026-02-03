import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createStorage,
	getStorage,
	closeStorage,
	buildArchiveKey,
	buildExpandedKey,
	buildParquetKey,
	type Storage,
} from "./index";

const TEST_STORAGE_PATH = join(tmpdir(), "storage-index-test");

describe("storage index", () => {
	describe("createStorage", () => {
		let storage: Storage;

		beforeEach(async () => {
			await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
			storage = createStorage(TEST_STORAGE_PATH);
		});

		afterEach(async () => {
			await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
		});

		it("should create a storage instance", () => {
			expect(storage).toBeDefined();
			expect(storage.put).toBeDefined();
			expect(storage.get).toBeDefined();
		});

		it("should be usable for put/get operations", async () => {
			await storage.put("test.txt", Buffer.from("test"));
			const data = await storage.get("test.txt");
			expect(data.toString()).toBe("test");
		});
	});

	describe("getStorage singleton", () => {
		const originalEnv = process.env.STORAGE_PATH;

		beforeEach(async () => {
			closeStorage();
			await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
			process.env.STORAGE_PATH = TEST_STORAGE_PATH;
		});

		afterEach(async () => {
			closeStorage();
			process.env.STORAGE_PATH = originalEnv;
			await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
		});

		it("should return same instance on repeated calls", () => {
			const storage1 = getStorage();
			const storage2 = getStorage();
			expect(storage1).toBe(storage2);
		});

		it("should throw if STORAGE_PATH is not set", () => {
			closeStorage();
			delete process.env.STORAGE_PATH;
			expect(() => getStorage()).toThrow(
				"STORAGE_PATH environment variable is required",
			);
		});
	});

	describe("key builders", () => {
		describe("buildArchiveKey", () => {
			it("should build correct archive key", () => {
				const date = new Date("2024-03-15");
				const key = buildArchiveKey("mercator", date, "prices.csv");
				expect(key).toBe("archives/mercator/2024-03-15/prices.csv");
			});

			it("should handle single-digit month and day", () => {
				const date = new Date("2024-01-05");
				const key = buildArchiveKey("spar", date, "data.xml");
				expect(key).toBe("archives/spar/2024-01-05/data.xml");
			});

			it("should handle filenames with special characters", () => {
				const date = new Date("2024-06-20");
				const key = buildArchiveKey("lidl", date, "prices_2024-06-20.csv");
				expect(key).toBe("archives/lidl/2024-06-20/prices_2024-06-20.csv");
			});
		});

		describe("buildExpandedKey", () => {
			it("should build correct expanded key", () => {
				const date = new Date("2024-03-15");
				const key = buildExpandedKey(
					"mercator",
					date,
					"archive.zip",
					"prices.csv",
				);
				expect(key).toBe("expanded/mercator/2024-03-15/archive/prices.csv");
			});

			it("should remove .ZIP extension (case insensitive)", () => {
				const date = new Date("2024-03-15");
				const key = buildExpandedKey(
					"mercator",
					date,
					"ARCHIVE.ZIP",
					"data.xml",
				);
				expect(key).toBe("expanded/mercator/2024-03-15/ARCHIVE/data.xml");
			});

			it("should preserve parent name without .zip", () => {
				const date = new Date("2024-03-15");
				const key = buildExpandedKey("spar", date, "data-pack", "file.json");
				expect(key).toBe("expanded/spar/2024-03-15/data-pack/file.json");
			});
		});

		describe("buildParquetKey", () => {
			it("should build correct parquet key", () => {
				const date = new Date("2024-03-15");
				const key = buildParquetKey("mercator", date);
				expect(key).toBe("parquet/mercator/2024-03-15/prices.parquet");
			});

			it("should handle different dates", () => {
				const date = new Date("2023-12-31");
				const key = buildParquetKey("lidl", date);
				expect(key).toBe("parquet/lidl/2023-12-31/prices.parquet");
			});
		});
	});
});
