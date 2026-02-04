import type { NormalizedRow, ParseError, ParseResult } from "../types";
import { decode, detectEncoding, type Encoding } from "./charset";
import { parsePrice } from "./price";

export type CsvDelimiter = "," | ";" | "\t";
export type CsvEncoding = Encoding;

export interface CsvColumnMapping {
	storeIdentifier?: string;
	externalId?: string;
	name: string;
	description?: string;
	category?: string;
	subcategory?: string;
	brand?: string;
	unit?: string;
	unitQuantity?: string;
	price: string;
	discountPrice?: string;
	discountStart?: string;
	discountEnd?: string;
	barcodes?: string;
	imageUrl?: string;
	unitPrice?: string;
	unitPriceBaseQuantity?: string;
	unitPriceBaseUnit?: string;
	lowestPrice30d?: string;
	anchorPrice?: string;
	anchorPriceAsOf?: string;
}

export interface CsvParserOptions {
	delimiter?: CsvDelimiter;
	encoding?: CsvEncoding;
	hasHeader?: boolean;
	columnMapping?: CsvColumnMapping;
	defaultStoreIdentifier?: string;
	skipEmptyRows?: boolean;
	quoteChar?: string;
}

export class CsvParser {
	private options: CsvParserOptions;
	private alternativeMapping?: CsvColumnMapping;

	constructor(options: CsvParserOptions) {
		this.options = options;
	}

	setAlternativeMapping(mapping?: CsvColumnMapping): void {
		this.alternativeMapping = mapping;
	}

	parse(content: Buffer): ParseResult {
		return this.parseWithStoreId(content, "");
	}

	parseWithStoreId(content: Buffer, storeId: string): ParseResult {
		const opts = this.resolveOptions();
		const encoding = opts.encoding ?? detectEncoding(content);
		const decoded = decode(content, encoding);
		const delimiter = opts.delimiter ?? detectDelimiter(decoded);
		const rows = parseCsvRows(decoded, delimiter, opts.quoteChar ?? '"');

		if (rows.length === 0) {
			return {
				rows: [],
				errors: [],
				warnings: [],
				totalRows: 0,
				validRows: 0,
			};
		}

		let headers: string[] = [];
		let dataStartRow = 0;
		if (opts.hasHeader) {
			headers = rows[0] ?? [];
			dataStartRow = 1;
		}

		const columnMapping = opts.columnMapping;
		if (!columnMapping) {
			return {
				rows: [],
				errors: [{ message: "No column mapping provided" }],
				warnings: [],
				totalRows: Math.max(0, rows.length - dataStartRow),
				validRows: 0,
			};
		}

		const indicesResult = buildColumnIndices(headers, columnMapping);
		if (indicesResult.error) {
			return {
				rows: [],
				errors: [{ message: indicesResult.error }],
				warnings: [],
				totalRows: Math.max(0, rows.length - dataStartRow),
				validRows: 0,
			};
		}

		const indices = indicesResult.indices;
		const result: ParseResult = {
			rows: [],
			errors: [],
			warnings: [],
			totalRows: 0,
			validRows: 0,
		};

		for (let i = dataStartRow; i < rows.length; i += 1) {
			const rawRow = rows[i];
			const rowNumber = i + 1;

			if (opts.skipEmptyRows && isEmptyRow(rawRow)) {
				continue;
			}

			result.totalRows += 1;

			const mapped = mapRowToNormalized(rawRow, rowNumber, indices, storeId);
			if (mapped.errors.length > 0 || !mapped.row) {
				for (const err of mapped.errors) {
					result.errors.push(err);
				}
				continue;
			}

			result.rows.push(mapped.row);
			result.validRows += 1;
		}

		if (result.validRows === 0 && this.alternativeMapping) {
			const altParser = new CsvParser({
				...opts,
				columnMapping: this.alternativeMapping,
			});
			return altParser.parseWithStoreId(content, storeId);
		}

		return result;
	}

	private resolveOptions(): CsvParserOptions {
		return {
			delimiter: this.options.delimiter ?? ",",
			encoding: this.options.encoding ?? "utf-8",
			hasHeader: this.options.hasHeader ?? true,
			columnMapping: this.options.columnMapping,
			defaultStoreIdentifier: this.options.defaultStoreIdentifier,
			skipEmptyRows: this.options.skipEmptyRows ?? true,
			quoteChar: this.options.quoteChar ?? '"',
		};
	}
}

function parseCsvRows(
	content: string,
	delimiter: CsvDelimiter,
	quoteChar: string,
): string[][] {
	const lines = splitLines(content);
	const rows: string[][] = [];
	const delimChar = delimiter;

	for (const line of lines) {
		if (line === "") {
			rows.push([]);
			continue;
		}
		const fields = splitCsvLine(line, delimChar, quoteChar);
		rows.push(fields.map((field) => field.trim()));
	}

	return rows;
}

function splitLines(content: string): string[] {
	return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function splitCsvLine(
	line: string,
	delimiter: string,
	quoteChar: string,
): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];

		if (inQuotes) {
			if (char === quoteChar) {
				if (i + 1 < line.length && line[i + 1] === quoteChar) {
					current += quoteChar;
					i += 1;
					continue;
				}
				inQuotes = false;
				continue;
			}
			current += char;
			continue;
		}

		if (char === quoteChar) {
			// Treat quote as a wrapper only at field start.
			// Some retailer exports contain literal quotes inside unquoted values
			// (e.g. O"PLANT), which should not switch parser state.
			if (current === "") {
				inQuotes = true;
				continue;
			}
			current += char;
			continue;
		}

		if (char === delimiter) {
			fields.push(current);
			current = "";
			continue;
		}

		current += char;
	}

	fields.push(current);
	return fields;
}

function isEmptyRow(row: string[]): boolean {
	return row.every((cell) => cell.trim() === "");
}

function normalizeHeader(header: string): string {
	const lower = header.trim().toLowerCase();
	const replaced = lower
		.replace(/[šŠ]/g, "s")
		.replace(/[čČ]/g, "c")
		.replace(/[ćĆ]/g, "c")
		.replace(/[žŽ]/g, "z")
		.replace(/[đĐ]/g, "d");
	return replaced;
}

function parseColumnIndex(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") {
		return null;
	}
	if (!/^\d+$/.test(trimmed)) {
		return null;
	}
	const parsed = Number.parseInt(trimmed, 10);
	if (Number.isNaN(parsed)) {
		return null;
	}
	return parsed;
}

function buildColumnIndices(
	headers: string[],
	mapping: CsvColumnMapping,
): { indices: Record<string, number>; error?: string } {
	const indices: Record<string, number> = {};

	const resolveIndex = (
		field: string,
		value: string | undefined,
		required: boolean,
	): string | null => {
		if (!value) {
			if (required) {
				return `required field ${field} not in mapping`;
			}
			return null;
		}

		const numeric = parseColumnIndex(value);
		if (numeric !== null) {
			indices[field] = numeric;
			return null;
		}

		let idx = headers.findIndex(
			(header) => header.trim().toLowerCase() === value.trim().toLowerCase(),
		);
		if (idx === -1) {
			const normalizedMapping = normalizeHeader(value);
			idx = headers.findIndex(
				(header) => normalizeHeader(header) === normalizedMapping,
			);
		}

		if (idx === -1) {
			if (required) {
				return `column '${value}' for field '${field}' not found in headers`;
			}
			return null;
		}

		indices[field] = idx;
		return null;
	};

	const requiredError =
		resolveIndex("name", mapping.name, true) ??
		resolveIndex("price", mapping.price, true);
	if (requiredError) {
		return { indices, error: requiredError };
	}

	resolveIndex("storeIdentifier", mapping.storeIdentifier, false);
	resolveIndex("externalId", mapping.externalId, false);
	resolveIndex("description", mapping.description, false);
	resolveIndex("category", mapping.category, false);
	resolveIndex("subcategory", mapping.subcategory, false);
	resolveIndex("brand", mapping.brand, false);
	resolveIndex("unit", mapping.unit, false);
	resolveIndex("unitQuantity", mapping.unitQuantity, false);
	resolveIndex("discountPrice", mapping.discountPrice, false);
	resolveIndex("discountStart", mapping.discountStart, false);
	resolveIndex("discountEnd", mapping.discountEnd, false);
	resolveIndex("barcodes", mapping.barcodes, false);
	resolveIndex("imageUrl", mapping.imageUrl, false);
	resolveIndex("unitPrice", mapping.unitPrice, false);
	resolveIndex("unitPriceBaseQuantity", mapping.unitPriceBaseQuantity, false);
	resolveIndex("unitPriceBaseUnit", mapping.unitPriceBaseUnit, false);
	resolveIndex("lowestPrice30d", mapping.lowestPrice30d, false);
	resolveIndex("anchorPrice", mapping.anchorPrice, false);
	resolveIndex("anchorPriceAsOf", mapping.anchorPriceAsOf, false);

	return { indices };
}

function mapRowToNormalized(
	rawRow: string[],
	rowNumber: number,
	indices: Record<string, number>,
	defaultStoreId: string,
): { row?: NormalizedRow; errors: ParseError[] } {
	const errors: ParseError[] = [];

	const getValue = (field: string): string | undefined => {
		const idx = indices[field];
		if (idx === undefined || idx >= rawRow.length) {
			return undefined;
		}
		const val = rawRow[idx]?.trim();
		if (!val) {
			return undefined;
		}
		return val;
	};

	let price = 0;
	const priceStr = getValue("price");
	if (priceStr) {
		try {
			price = parsePrice(priceStr);
		} catch {
			errors.push({
				rowNumber,
				field: "price",
				message: "Invalid price value",
				originalValue: priceStr,
			});
		}
	}

	if (price === 0) {
		const discountPriceStr = getValue("discountPrice");
		if (discountPriceStr) {
			try {
				const parsed = parsePrice(discountPriceStr);
				if (parsed > 0) {
					price = parsed;
				}
			} catch {
				// Ignore fallback failures
			}
		}
	}

	let discountPrice: number | undefined;
	const discountStr = getValue("discountPrice");
	if (discountStr) {
		try {
			discountPrice = parsePrice(discountStr);
		} catch {
			// Ignore
		}
	}

	const discountStart = parseDate(getValue("discountStart"));
	const discountEnd = parseDate(getValue("discountEnd"));

	const barcodes: string[] = [];
	const barcodeStr = getValue("barcodes");
	if (barcodeStr) {
		const parts = barcodeStr.split(/[,;]/);
		for (const part of parts) {
			const trimmed = part.trim();
			if (trimmed) {
				barcodes.push(trimmed);
			}
		}
	}

	let unitPrice: number | undefined;
	const unitPriceStr = getValue("unitPrice");
	if (unitPriceStr) {
		try {
			unitPrice = parsePrice(unitPriceStr);
		} catch {
			// Ignore
		}
	}

	let lowestPrice30d: number | undefined;
	const lowestPriceStr = getValue("lowestPrice30d");
	if (lowestPriceStr) {
		try {
			lowestPrice30d = parsePrice(lowestPriceStr);
		} catch {
			// Ignore
		}
	}

	let anchorPrice: number | undefined;
	const anchorPriceStr = getValue("anchorPrice");
	if (anchorPriceStr) {
		try {
			anchorPrice = parsePrice(anchorPriceStr);
		} catch {
			// Ignore
		}
	}

	const anchorPriceAsOf = parseDate(getValue("anchorPriceAsOf"));

	const storeIdentifier = getValue("storeIdentifier") ?? defaultStoreId;
	const name = getValue("name") ?? "";
	if (!name) {
		errors.push({
			rowNumber,
			field: "name",
			message: "Name is required",
		});
	}

	if (errors.length > 0) {
		return { errors };
	}

	const rawData = JSON.stringify(rawRow);
	const row: NormalizedRow = {
		storeIdentifier,
		externalId: getValue("externalId"),
		name,
		description: getValue("description"),
		category: getValue("category"),
		subcategory: getValue("subcategory"),
		brand: getValue("brand"),
		unit: getValue("unit"),
		unitQuantity: getValue("unitQuantity"),
		price,
		discountPrice,
		discountStart,
		discountEnd,
		barcodes,
		imageUrl: getValue("imageUrl"),
		rowNumber,
		rawData,
		unitPrice,
		unitPriceBaseQuantity: getValue("unitPriceBaseQuantity"),
		unitPriceBaseUnit: getValue("unitPriceBaseUnit"),
		lowestPrice30d,
		anchorPrice,
		anchorPriceAsOf,
	};

	return { row, errors: [] };
}

export function detectDelimiter(content: string): CsvDelimiter {
	const lines = content.split("\n");
	const sampleLines: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed) {
			sampleLines.push(trimmed);
			if (sampleLines.length >= 5) {
				break;
			}
		}
	}

	if (sampleLines.length === 0) {
		return ",";
	}

	const delimiters: CsvDelimiter[] = [",", ";", "\t"];
	let bestDelimiter: CsvDelimiter = ",";
	let maxConsistency = 0;

	for (const delimiter of delimiters) {
		const counts = sampleLines.map((line) => line.split(delimiter).length - 1);
		const sum = counts.reduce((acc, count) => acc + count, 0);
		const avgCount = sum / counts.length;
		if (avgCount === 0) {
			continue;
		}
		let variance = 0;
		for (const count of counts) {
			const diff = count - avgCount;
			variance += diff * diff;
		}
		variance /= counts.length;
		const consistency = avgCount / (1 + variance);
		if (consistency > maxConsistency) {
			maxConsistency = consistency;
			bestDelimiter = delimiter;
		}
	}

	return bestDelimiter;
}

function parseDate(value?: string): Date | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const formats: Array<{
		regex: RegExp;
		builder: (match: RegExpMatchArray) => Date;
	}> = [
		{
			regex: /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
			builder: (m) =>
				new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
		},
		{
			regex: /^(\d{4})\/(\d{2})\/(\d{2})$/,
			builder: (m) =>
				new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
		},
		{
			regex: /^(\d{2})\.(\d{2})\.(\d{4})$/,
			builder: (m) =>
				new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))),
		},
		{
			regex: /^(\d{2})\/(\d{2})\/(\d{4})$/,
			builder: (m) =>
				new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))),
		},
		{
			regex: /^(\d{2})-(\d{2})-(\d{4})$/,
			builder: (m) =>
				new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))),
		},
		{
			regex: /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
			builder: (m) =>
				new Date(
					Date.UTC(
						Number(m[1]),
						Number(m[2]) - 1,
						Number(m[3]),
						Number(m[4]),
						Number(m[5]),
						Number(m[6]),
					),
				),
		},
		{
			regex: /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
			builder: (m) =>
				new Date(
					Date.UTC(
						Number(m[1]),
						Number(m[2]) - 1,
						Number(m[3]),
						Number(m[4]),
						Number(m[5]),
						Number(m[6]),
					),
				),
		},
	];

	for (const format of formats) {
		const match = trimmed.match(format.regex);
		if (match) {
			return format.builder(match);
		}
	}

	const parsed = Date.parse(trimmed);
	if (!Number.isNaN(parsed)) {
		return new Date(parsed);
	}

	return undefined;
}
