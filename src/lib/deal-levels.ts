export type DealLevel = "best" | "good" | "neutral" | "bad" | "worst";

/**
 * Given a price and the best (cheapest) price, compute a deal level.
 * Best = cheapest, within 5% = good, 5-15% = neutral, 15-30% = bad, >30% = worst
 */
export function computeDealLevel(price: number, bestPrice: number): DealLevel {
	if (bestPrice <= 0) return "neutral";
	if (price <= bestPrice) return "best";

	const pctAbove = ((price - bestPrice) / bestPrice) * 100;

	if (pctAbove <= 5) return "good";
	if (pctAbove <= 15) return "neutral";
	if (pctAbove <= 30) return "bad";
	return "worst";
}
