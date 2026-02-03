import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as path from "node:path";
import { LocalStorage, MIN_COMPRESSION_SIZE, computeChecksum } from "./local";

const TEST_STORAGE_PATH = join(tmpdir(), "storage-test");

describe("LocalStorage", () => {
	let storage: LocalStorage;

	beforeEach(async () => {
		// Clean up and create fresh test directory
		await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
		storage = new LocalStorage(TEST_STORAGE_PATH);
	});

	afterEach(async () => {
		await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
	});

	describe("put/get round-trip", () => {
		it("should store and retrieve small data without compression", async () => {
			const data = Buffer.from("Hello, World!");
			await storage.put("test/hello.txt", data);

			const retrieved = await storage.get("test/hello.txt");
			expect(retrieved.toString()).toBe("Hello, World!");
		});

		it("should store and retrieve large data", async () => {
			const data = Buffer.from("Large content ".repeat(1000));
			await storage.put("test/large.txt", data);

			const retrieved = await storage.get("test/large.txt");
			expect(retrieved.toString()).toBe(data.toString());
		});

		it("should store data with nested paths", async () => {
			const data = Buffer.from("Nested content");
			await storage.put("a/b/c/d/file.txt", data);

			const retrieved = await storage.get("a/b/c/d/file.txt");
			expect(retrieved.toString()).toBe("Nested content");
		});

		it("should store binary data correctly", async () => {
			const data = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
			await storage.put("test/binary.bin", data);

			const retrieved = await storage.get("test/binary.bin");
			expect(Buffer.compare(retrieved, data)).toBe(0);
		});
	});

	describe("compression", () => {
		it("should compress csv files above minimum size", async () => {
			const data = Buffer.from("csv,data,here\n".repeat(200));
			expect(data.length).toBeGreaterThan(MIN_COMPRESSION_SIZE);

			await storage.put("test/data.csv", data, {
				custom: { file_type: "csv" },
			});

			// Check that .gz file exists
			const gzPath = path.join(TEST_STORAGE_PATH, "test/data.csv.gz");
			const gzStats = await stat(gzPath);
			expect(gzStats.isFile()).toBe(true);

			// Compressed should be smaller
			expect(gzStats.size).toBeLessThan(data.length);

			// But retrieval should return original
			const retrieved = await storage.get("test/data.csv");
			expect(retrieved.toString()).toBe(data.toString());
		});

		it("should compress xml files above minimum size", async () => {
			const data = Buffer.from("<root><item>data</item></root>".repeat(100));
			await storage.put("test/data.xml", data, {
				custom: { file_type: "xml" },
			});

			const retrieved = await storage.get("test/data.xml");
			expect(retrieved.toString()).toBe(data.toString());
		});

		it("should compress json files above minimum size", async () => {
			const data = Buffer.from('{"key": "value"}'.repeat(200));
			await storage.put("test/data.json", data, {
				custom: { file_type: "json" },
			});

			const retrieved = await storage.get("test/data.json");
			expect(retrieved.toString()).toBe(data.toString());
		});

		it("should not compress xlsx files", async () => {
			const data = Buffer.from("x".repeat(2000));
			await storage.put("test/data.xlsx", data, {
				custom: { file_type: "xlsx" },
			});

			// Check that uncompressed file exists
			const filePath = path.join(TEST_STORAGE_PATH, "test/data.xlsx");
			const fileStats = await stat(filePath);
			expect(fileStats.isFile()).toBe(true);
			expect(fileStats.size).toBe(data.length);
		});

		it("should not compress files below minimum size", async () => {
			const data = Buffer.from("small");
			expect(data.length).toBeLessThan(MIN_COMPRESSION_SIZE);

			await storage.put("test/small.csv", data, {
				custom: { file_type: "csv" },
			});

			// Check that uncompressed file exists
			const filePath = path.join(TEST_STORAGE_PATH, "test/small.csv");
			const fileStats = await stat(filePath);
			expect(fileStats.isFile()).toBe(true);
			expect(fileStats.size).toBe(data.length);
		});
	});

	describe("exists", () => {
		it("should return false for non-existent file", async () => {
			const exists = await storage.exists("nonexistent.txt");
			expect(exists).toBe(false);
		});

		it("should return true for existing uncompressed file", async () => {
			await storage.put("test/file.txt", Buffer.from("content"));
			const exists = await storage.exists("test/file.txt");
			expect(exists).toBe(true);
		});

		it("should return true for existing compressed file", async () => {
			const data = Buffer.from("csv,data\n".repeat(200));
			await storage.put("test/data.csv", data, {
				custom: { file_type: "csv" },
			});

			const exists = await storage.exists("test/data.csv");
			expect(exists).toBe(true);
		});
	});

	describe("delete", () => {
		it("should delete uncompressed file", async () => {
			await storage.put("test/file.txt", Buffer.from("content"));
			expect(await storage.exists("test/file.txt")).toBe(true);

			await storage.delete("test/file.txt");
			expect(await storage.exists("test/file.txt")).toBe(false);
		});

		it("should delete compressed file", async () => {
			const data = Buffer.from("csv,data\n".repeat(200));
			await storage.put("test/data.csv", data, {
				custom: { file_type: "csv" },
			});
			expect(await storage.exists("test/data.csv")).toBe(true);

			await storage.delete("test/data.csv");
			expect(await storage.exists("test/data.csv")).toBe(false);
		});

		it("should not throw when deleting non-existent file", async () => {
			await expect(storage.delete("nonexistent.txt")).resolves.not.toThrow();
		});
	});

	describe("list", () => {
		it("should list files matching prefix", async () => {
			await storage.put("test/a.txt", Buffer.from("a"));
			await storage.put("test/b.txt", Buffer.from("b"));
			await storage.put("other/c.txt", Buffer.from("c"));

			const files = await storage.list("test/");
			expect(files).toContain("test/a.txt");
			expect(files).toContain("test/b.txt");
			expect(files).not.toContain("other/c.txt");
		});

		it("should strip .gz suffix from compressed files", async () => {
			const data = Buffer.from("csv,data\n".repeat(200));
			await storage.put("test/data.csv", data, {
				custom: { file_type: "csv" },
			});

			const files = await storage.list("test/");
			expect(files).toContain("test/data.csv");
			expect(files).not.toContain("test/data.csv.gz");
		});

		it("should return empty array for non-existent prefix", async () => {
			const files = await storage.list("nonexistent/");
			expect(files).toEqual([]);
		});

		it("should handle nested directories", async () => {
			await storage.put("a/b/c/file1.txt", Buffer.from("1"));
			await storage.put("a/b/d/file2.txt", Buffer.from("2"));
			await storage.put("a/e/file3.txt", Buffer.from("3"));

			const files = await storage.list("a/b/");
			expect(files).toContain("a/b/c/file1.txt");
			expect(files).toContain("a/b/d/file2.txt");
			expect(files).not.toContain("a/e/file3.txt");
		});
	});

	describe("getInfo", () => {
		it("should return file info for uncompressed file", async () => {
			const data = Buffer.from("Test content for info");
			await storage.put("test/info.txt", data);

			const info = await storage.getInfo("test/info.txt");

			expect(info.key).toBe("test/info.txt");
			expect(info.size).toBe(data.length);
			expect(info.checksum).toBeDefined();
			expect(info.checksum.length).toBe(64); // SHA256 hex length
			expect(info.modifiedAt).toBeInstanceOf(Date);
		});

		it("should return file info for compressed file", async () => {
			const data = Buffer.from("csv,data\n".repeat(200));
			await storage.put("test/data.csv", data, {
				custom: { file_type: "csv" },
			});

			const info = await storage.getInfo("test/data.csv");

			expect(info.key).toBe("test/data.csv");
			expect(info.size).toBeLessThan(data.length); // Compressed size
			expect(info.metadata?.custom?.compressed).toBe("true");
		});

		it("should throw for non-existent file", async () => {
			await expect(storage.getInfo("nonexistent.txt")).rejects.toThrow(
				"file not found",
			);
		});
	});

	describe("getChecksum", () => {
		it("should return consistent checksum for same content", async () => {
			const data = Buffer.from("Checksum test content");
			await storage.put("test/checksum.txt", data);

			const checksum1 = await storage.getChecksum("test/checksum.txt");
			const checksum2 = await storage.getChecksum("test/checksum.txt");

			expect(checksum1).toBe(checksum2);
		});

		it("should return different checksum for different content", async () => {
			await storage.put("test/file1.txt", Buffer.from("Content 1"));
			await storage.put("test/file2.txt", Buffer.from("Content 2"));

			const checksum1 = await storage.getChecksum("test/file1.txt");
			const checksum2 = await storage.getChecksum("test/file2.txt");

			expect(checksum1).not.toBe(checksum2);
		});
	});

	describe("path traversal prevention", () => {
		it("should reject keys with path traversal", async () => {
			await expect(
				storage.put("../outside.txt", Buffer.from("bad")),
			).rejects.toThrow("path traversal");
		});

		it("should reject keys with embedded path traversal", async () => {
			await expect(
				storage.put("test/../../../outside.txt", Buffer.from("bad")),
			).rejects.toThrow("path traversal");
		});

		it("should accept keys with .. in filename (not traversal)", async () => {
			// This should be fine - it's just a filename with dots
			await expect(
				storage.put("test/file..name.txt", Buffer.from("ok")),
			).resolves.not.toThrow();
		});
	});

	describe("computeChecksum", () => {
		it("should compute SHA256 checksum", () => {
			const data = Buffer.from("Hello, World!");
			const checksum = computeChecksum(data);

			// Known SHA256 of "Hello, World!"
			expect(checksum).toBe(
				"dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f",
			);
		});

		it("should return different checksums for different data", () => {
			const checksum1 = computeChecksum(Buffer.from("Data 1"));
			const checksum2 = computeChecksum(Buffer.from("Data 2"));

			expect(checksum1).not.toBe(checksum2);
		});
	});
});
