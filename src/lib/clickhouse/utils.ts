/**
 * Parse a value that may be a number or string into a number, or null.
 * ClickHouse sometimes returns numbers as strings in JSON format.
 */
export const parseNumber = (value?: number | string | null): number | null => {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return Number.isFinite(value) ? value : null;
};
