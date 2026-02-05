import { describe, expect, it } from "vitest";
import { safeQuery } from "../safe-db";

describe("safeQuery", () => {
	it("returns ok result", async () => {
		const result = await safeQuery(() => Promise.resolve(42), { operation: "select" });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBe(42);
	});

	it("returns err result", async () => {
		const result = await safeQuery(() => Promise.reject(new Error("fail")), {
			operation: "insert",
			table: "users",
		});

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error.message).toBe("fail");
		expect(error.table).toBe("users");
	});

	it("extracts pg code", async () => {
		const result = await safeQuery(() => Promise.reject({ code: "40P01", message: "deadlock" }), {
			operation: "update",
			table: "users",
		});

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error.code).toBe("40P01");
	});

	it("extracts nested pg code", async () => {
		const result = await safeQuery(() => Promise.reject({ cause: { code: "23505" } }), {
			operation: "insert",
			table: "users",
		});

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error.code).toBe("23505");
	});
});
