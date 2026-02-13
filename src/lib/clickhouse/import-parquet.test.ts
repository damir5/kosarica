import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClickHouseClient as CHClient } from "@clickhouse/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickHouseClient } from "./index";

function createStubRawClient(): CHClient {
	return {
		query: vi.fn(),
		command: vi.fn(),
		insert: vi.fn(),
		close: vi.fn(),
	} as unknown as CHClient;
}

describe("ClickHouseClient.importParquetFile", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("uploads parquet using direct HTTP binary insert", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("", { status: 200 }));
		const tempDir = mkdtempSync(join(tmpdir(), "ch-import-"));
		const parquetPath = join(tempDir, "prices.parquet");
		writeFileSync(parquetPath, Buffer.from([0x50, 0x41, 0x52, 0x31]));

		const client = new ClickHouseClient(createStubRawClient(), {
			url: "http://clickhouse.internal:8123",
			database: "analytics",
			username: "kosarica",
			password: "secret",
		});

		await client.importParquetFile(parquetPath);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [urlArg, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
		expect(urlArg.toString()).toContain(
			"query=INSERT+INTO+prices+FORMAT+Parquet",
		);
		expect(urlArg.toString()).toContain("database=analytics");
		expect(init.method).toBe("POST");
		expect(init.headers).toMatchObject({
			"content-type": "application/octet-stream",
			authorization: "Basic a29zYXJpY2E6c2VjcmV0",
		});
		expect(init.body).toBeInstanceOf(Uint8Array);
	});

	it("throws with response details on import failure", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("syntax error", { status: 400 }));
		const tempDir = mkdtempSync(join(tmpdir(), "ch-import-"));
		const parquetPath = join(tempDir, "prices.parquet");
		writeFileSync(parquetPath, Buffer.from([0x50, 0x41, 0x52, 0x31]));

		const client = new ClickHouseClient(createStubRawClient(), {
			url: "http://clickhouse.internal:8123",
			database: "default",
		});

		await expect(client.importParquetFile(parquetPath)).rejects.toThrow(
			"ClickHouse parquet import failed",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
