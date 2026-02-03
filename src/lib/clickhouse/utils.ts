/**
 * Parse a value that may be a number or string into a number, or null.
 * ClickHouse sometimes returns numbers as strings in JSON format.
 */
export const parseNumber = (value?: number | string | null): number | null => {
	if (value === null || value === undefined) return null;
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isNaN(parsed) ? null : parsed;
};
