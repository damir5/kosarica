const currencySuffixPattern = /\s*(KN|KUNA|HRK|EUR|USD)\s*$/i;

export function parsePrice(value: string): number {
	if (!value || value.trim() === "") {
		throw new Error("empty price value");
	}

	let cleaned = value.trim();
	cleaned = cleaned
		.replace(/[€$£₹¥¢\u00A0]/g, "")
		.replace(currencySuffixPattern, "")
		.trim();

	if (cleaned === "") {
		throw new Error("no numeric value found");
	}

	const lastDot = cleaned.lastIndexOf(".");
	const lastComma = cleaned.lastIndexOf(",");

	if (lastComma > lastDot) {
		cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
	} else if (lastDot > lastComma) {
		cleaned = cleaned.replace(/,/g, "");
	}

	const parsed = Number.parseFloat(cleaned);
	if (Number.isNaN(parsed)) {
		throw new Error("invalid price format");
	}

	return Math.round(parsed * 100);
}

export function formatCents(cents: number): string {
	return (cents / 100).toFixed(2);
}

export function formatCentsEuropean(cents: number): string {
	return formatCents(cents).replace(".", ",");
}
