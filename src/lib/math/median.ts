export function median(values: readonly number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = Array.from(values).sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[middle - 1] + sorted[middle]) / 2;
	}
	return sorted[middle];
}
