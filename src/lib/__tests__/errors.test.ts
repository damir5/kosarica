import { describe, expect, it } from "vitest";
import {
	dbError,
	fetchError,
	isDeadlock,
	isUniqueViolation,
	storageError,
	toLogContext,
} from "../errors";

describe("errors", () => {
	it("creates DbError", () => {
		const error = dbError({
			operation: "insert",
			table: "users",
			message: "fail",
			code: "23505",
			cause: new Error("boom"),
		});

		expect(error._tag).toBe("DbError");
		expect(error.operation).toBe("insert");
		expect(error.table).toBe("users");
		expect(error.message).toBe("fail");
		expect(error.code).toBe("23505");
		expect(error.cause).toBeInstanceOf(Error);
	});

	it("creates FetchError", () => {
		const error = fetchError({
			url: "https://example.com",
			status: 500,
			message: "server",
			retryable: true,
			attempts: 2,
		});

		expect(error._tag).toBe("FetchError");
		expect(error.url).toBe("https://example.com");
		expect(error.status).toBe(500);
	});

	it("creates StorageError", () => {
		const error = storageError({
			operation: "get",
			key: "file.txt",
			message: "missing",
		});

		expect(error._tag).toBe("StorageError");
		expect(error.operation).toBe("get");
		expect(error.key).toBe("file.txt");
	});

	it("detects deadlocks", () => {
		const deadlock = dbError({
			operation: "insert",
			message: "deadlock",
			code: "40P01",
		});
		const unique = dbError({
			operation: "insert",
			message: "unique",
			code: "23505",
		});

		expect(isDeadlock(deadlock)).toBe(true);
		expect(isDeadlock(unique)).toBe(false);
	});

	it("detects unique violations", () => {
		const unique = dbError({
			operation: "insert",
			message: "unique",
			code: "23505",
		});
		const deadlock = dbError({
			operation: "insert",
			message: "deadlock",
			code: "40P01",
		});

		expect(isUniqueViolation(unique)).toBe(true);
		expect(isUniqueViolation(deadlock)).toBe(false);
	});

	it("serializes log context", () => {
		const cause = new Error("boom");
		const error = dbError({
			operation: "select",
			message: "failed",
			cause,
		});

		const context = toLogContext(error);

		expect(context.errorTag).toBe("DbError");
		expect(context.cause).toBeDefined();
		expect(context).toMatchObject({
			operation: "select",
			message: "failed",
		});
	});
});
