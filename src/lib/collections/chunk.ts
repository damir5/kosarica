export function chunk<T>(items: readonly T[], size: number): T[][] {
	if (items.length === 0) {
		return [];
	}
	if (size <= 0) {
		return [Array.from(items)];
	}
	const batches: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		batches.push(items.slice(index, index + size));
	}
	return batches;
}
