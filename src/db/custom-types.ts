import { text } from "drizzle-orm/pg-core";
import { generatePrefixedId } from "@/utils/id";

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
 * @param prefix - The prefix to prepend to the ID (e.g., 'usr', 'ses', 'cfg')
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
