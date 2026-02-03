import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	compressGzip,
	compressGzipStream,
	decompressGzip,
	decompressGzipStream,
	shouldCompress,
} from "./compression";

describe("compression", () => {
	describe("compressGzip / decompressGzip", () => {
		it("should compress and decompress data correctly", async () => {
			const original = Buffer.from("Hello, World! ".repeat(100));
			const compressed = await compressGzip(original);
			const decompressed = await decompressGzip(compressed);

			expect(decompressed.toString()).toBe(original.toString());
		});

		it("should produce smaller output for compressible text", async () => {
			const original = Buffer.from("a".repeat(10000));
			const compressed = await compressGzip(original);

			expect(compressed.length).toBeLessThan(original.length);
		});

		it("should handle empty data", async () => {
			const original = Buffer.from("");
			const compressed = await compressGzip(original);
			const decompressed = await decompressGzip(compressed);

			expect(decompressed.toString()).toBe("");
		});

		it("should handle binary data", async () => {
			const original = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
			const compressed = await compressGzip(original);
			const decompressed = await decompressGzip(compressed);

			expect(Buffer.compare(decompressed, original)).toBe(0);
		});
	});

	describe("compressGzipStream / decompressGzipStream", () => {
		it("should compress and decompress stream data correctly", async () => {
			const original = Buffer.from("Streaming test data! ".repeat(100));
			const readable = Readable.from(original);
			const compressed = await compressGzipStream(readable);

			const readableCompressed = Readable.from(compressed);
			const decompressed = await decompressGzipStream(readableCompressed);

			expect(decompressed.toString()).toBe(original.toString());
		});

		it("should produce identical results to buffer version", async () => {
			const original = Buffer.from("Compare streaming vs buffer");

			const compressedBuffer = await compressGzip(original);
			const compressedStream = await compressGzipStream(
				Readable.from(original),
			);

			// Note: gzip output may have minor differences in headers/timestamps
			// so we compare by decompressing both
			const decompressedBuffer = await decompressGzip(compressedBuffer);
			const decompressedStream = await decompressGzip(compressedStream);

			expect(decompressedBuffer.toString()).toBe(decompressedStream.toString());
		});
	});

	describe("shouldCompress", () => {
		it("should return true for csv files", () => {
			expect(shouldCompress("csv")).toBe(true);
		});

		it("should return true for xml files", () => {
			expect(shouldCompress("xml")).toBe(true);
		});

		it("should return true for json files", () => {
			expect(shouldCompress("json")).toBe(true);
		});

		it("should return false for xlsx files (already compressed)", () => {
			expect(shouldCompress("xlsx")).toBe(false);
		});

		it("should return false for xls files (already compressed)", () => {
			expect(shouldCompress("xls")).toBe(false);
		});

		it("should return false for zip files", () => {
			expect(shouldCompress("zip")).toBe(false);
		});

		it("should return false for gz files", () => {
			expect(shouldCompress("gz")).toBe(false);
		});

		it("should return false for bz2 files", () => {
			expect(shouldCompress("bz2")).toBe(false);
		});

		it("should return false for xz files", () => {
			expect(shouldCompress("xz")).toBe(false);
		});

		it("should return false for zst files", () => {
			expect(shouldCompress("zst")).toBe(false);
		});

		it("should return false for unknown file types", () => {
			expect(shouldCompress("unknown")).toBe(false);
			expect(shouldCompress("")).toBe(false);
			expect(shouldCompress("pdf")).toBe(false);
		});
	});
});
