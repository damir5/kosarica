import { customType, text } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { generatePrefixedId } from "@/utils/id";

/**
 * Creates a typed JSONB column with runtime validation.
 * The Zod schema serves as the single source of truth for the type.
 *
 * @param schema - Zod schema for validation
 * @param name - Column name in the database
 * @returns A Drizzle custom type with typed input/output
 */
export function typedJsonb<T extends z.ZodType>(schema: T, name: string) {
	type Data = z.infer<T>;
	return customType<{ data: Data; driverData: string }>({
		dataType() {
			return "jsonb";
		},
		toDriver(value: Data): string {
			return JSON.stringify(value);
		},
		fromDriver(value: unknown): Data {
			const parsed = typeof value === "string" ? JSON.parse(value) : value;
			return schema.parse(parsed);
		},
	})(name);
}

/**
 * Options for cuid2 column type.
 */
export interface Cuid2Options {
	/**
	 * Include time-sortable prefix for B-tree index locality (default: true).
	 * Set to false for pure random IDs.
	 */
	timeSortable?: boolean;
}

/**
 * Creates an ID column with a specified prefix using crypto-based IDs.
 * Uses native crypto APIs for Cloudflare Workers compatibility.
 *
 * By default, generates time-sortable IDs (6-char timestamp + 18-char random)
 * for better B-tree index locality.
 *
 * @param prefix - The prefix to prepend to ID (e.g., 'usr', 'ses', 'cfg')
 * @param options - Optional configuration (timeSortable defaults to true)
 * @returns A text column configured to generate prefixed crypto IDs
 *
 * Example generated IDs:
 * - Time-sortable (default): `usr_0CL2KwaB3cD5eF7gH9iJ1k`
 * - Pure random: `usr_8kJ2mN4pQ6rS0tU3vW5xY7zA`
 */
export function cuid2(prefix: string, options: Cuid2Options = {}) {
	const { timeSortable = true } = options;
	return text("id").$defaultFn(() =>
		generatePrefixedId(prefix, { timeSortable }),
	);
}

/**
 * Creates a pgvector column with a specified number of dimensions.
 * Uses vector(N) SQL type for pgvector extension.
 *
 * @param name - Column name in the database
 * @param dimensions - Number of vector dimensions (e.g. 1024 for BGE-M3)
 */
export function pgVector(name: string, dimensions: number) {
	function validateVector(value: number[]): number[] {
		if (value.length !== dimensions) {
			throw new Error(
				`Invalid vector dimension for ${name}: expected ${dimensions}, got ${value.length}`,
			);
		}
		for (const component of value) {
			if (!Number.isFinite(component)) {
				throw new Error(
					`Invalid vector value for ${name}: non-finite component`,
				);
			}
		}
		return value;
	}

	function parseVector(value: unknown): number[] {
		if (typeof value === "string") {
			const trimmed = value.replace(/^\[/, "").replace(/\]$/, "").trim();
			if (trimmed === "") {
				return [];
			}
			return trimmed.split(",").map((component) => Number(component));
		}
		if (Array.isArray(value)) {
			return value.map((component) => Number(component));
		}
		throw new Error(
			`Invalid vector payload for ${name}: expected string or array`,
		);
	}

	return customType<{ data: number[]; driverValue: string }>({
		dataType() {
			return `vector(${dimensions})`;
		},
		toDriver(value: number[]): string {
			const vector = validateVector(value);
			return `[${vector.join(",")}]`;
		},
		fromDriver(value: unknown): number[] {
			return validateVector(parseVector(value));
		},
	})(name);
}
