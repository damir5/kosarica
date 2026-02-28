import { err, ok, type Result } from "neverthrow";

const currencySuffixPattern = /\s*(KN|KUNA|HRK|EUR|USD)\s*$/i;

export interface PriceParseError {
	readonly _tag: "PriceParseError";
	readonly message: string;
	readonly value?: string;
}

function priceParseError(message: string, value?: string): PriceParseError {
	return { _tag: "PriceParseError", message, value };
}

export function parsePrice(value: string): Result<number, PriceParseError> {
	if (!value || value.trim() === "") {
		return err(priceParseError("empty price value", value));
	}

	let cleaned = value.trim();
	cleaned = cleaned
		.replace(/[€$£₹¥¢\u00A0]/g, "")
		.replace(currencySuffixPattern, "")
		.trim();

	if (cleaned === "") {
		return err(priceParseError("no numeric value found", value));
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
		return err(priceParseError("invalid price format", value));
	}

	return ok(Math.round(parsed * 100));
}

export function formatCents(cents: number): string {
	return (cents / 100).toFixed(2);
}

export function formatCentsEuropean(cents: number): string {
	return formatCents(cents).replace(".", ",");
}
