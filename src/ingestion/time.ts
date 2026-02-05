const ZAGREB_TIMEZONE = "Europe/Zagreb";

interface TimezoneDateParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function parseDatePart(
	parts: Intl.DateTimeFormatPart[],
	type: Intl.DateTimeFormatPartTypes,
): number {
	const value = parts.find((part) => part.type === type)?.value;
	if (!value) {
		return 0;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function getTimezoneDateParts(
	date: Date,
	timezone: string = ZAGREB_TIMEZONE,
): TimezoneDateParts {
	const formatter = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = formatter.formatToParts(date);
	return {
		year: parseDatePart(parts, "year"),
		month: parseDatePart(parts, "month"),
		day: parseDatePart(parts, "day"),
		hour: parseDatePart(parts, "hour"),
		minute: parseDatePart(parts, "minute"),
		second: parseDatePart(parts, "second"),
	};
}

export function formatDateParts(parts: {
	year: number;
	month: number;
	day: number;
}): string {
	return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatDateInTimezone(
	date: Date,
	timezone: string = ZAGREB_TIMEZONE,
): string {
	return formatDateParts(getTimezoneDateParts(date, timezone));
}

export function getCurrentDateInTimezone(
	timezone: string = ZAGREB_TIMEZONE,
): string {
	return formatDateInTimezone(new Date(), timezone);
}

export function compareDateKeys(left: string, right: string): number {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

export { ZAGREB_TIMEZONE };
