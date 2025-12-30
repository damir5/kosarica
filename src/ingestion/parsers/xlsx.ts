/**
 * XLSX Parser Module
 *
 * Parser for Excel (.xlsx, .xls) files using SheetJS (xlsx library).
 * Supports mapping columns to NormalizedRow fields.
 */

import * as XLSX from "xlsx";
import type { FileType, NormalizedRow } from "../core/types";
import { type ParseContext, Parser } from "./base";

/**
 * Column mapping configuration.
 * Maps NormalizedRow field names to column indices or header names.
 */
export interface XlsxColumnMapping {
	/** Column for store identifier */
	storeIdentifier?: number | string;
	/** Column for external ID */
	externalId?: number | string;
	/** Column for item name (required) */
	name: number | string;
	/** Column for description */
	description?: number | string;
	/** Column for category */
	category?: number | string;
	/** Column for subcategory */
	subcategory?: number | string;
	/** Column for brand */
	brand?: number | string;
	/** Column for unit */
	unit?: number | string;
	/** Column for unit quantity */
	unitQuantity?: number | string;
	/** Column for price (required) */
	price: number | string;
	/** Column for discount price */
	discountPrice?: number | string;
	/** Column for discount start date */
	discountStart?: number | string;
	/** Column for discount end date */
	discountEnd?: number | string;
	/** Column for barcodes (can be comma-separated) */
	barcodes?: number | string;
	/** Column for image URL */
	imageUrl?: number | string;
}

/**
 * XLSX parser options.
 */
export interface XlsxParserOptions {
	/** Column mapping configuration */
	columnMapping?: XlsxColumnMapping;
	/** Whether the first row is a header */
	hasHeader?: boolean;
	/** Default store identifier if not in spreadsheet */
	defaultStoreIdentifier?: string;
	/** Skip empty rows */
	skipEmptyRows?: boolean;
	/** Sheet name or index to parse (default: first sheet) */
	sheetNameOrIndex?: string | number;
	/** Number of header rows to skip (default: 0, or 1 if hasHeader is true) */
	headerRowCount?: number;
}

/**
 * Default XLSX parser options.
 */
const DEFAULT_OPTIONS: Required<
	Omit<
		XlsxParserOptions,
		"columnMapping" | "defaultStoreIdentifier" | "sheetNameOrIndex"
	>
> = {
	hasHeader: true,
	skipEmptyRows: true,
	headerRowCount: 0,
};

/**
 * XLSX Parser implementation.
 * Parses Excel files (.xlsx, .xls) with configurable column mapping.
 */
export class XlsxParser extends Parser {
	readonly fileType: FileType = "xlsx";
	readonly extensions: string[] = [".xlsx", ".xls"];

	private options: XlsxParserOptions;

	constructor(options: XlsxParserOptions = {}) {
		super();
		this.options = options;
	}

	/**
	 * Set parser options.
	 * @param options - Options to merge with existing
	 */
	setOptions(options: Partial<XlsxParserOptions>): void {
		this.options = { ...this.options, ...options };
	}

	/**
	 * Parse XLSX content into normalized rows.
	 */
	protected async parseRows(
		context: ParseContext,
	): Promise<{ rows: NormalizedRow[]; totalRows: number }> {
		const opts = { ...DEFAULT_OPTIONS, ...this.options };

		// Parse workbook from ArrayBuffer
		let workbook: XLSX.WorkBook;
		try {
			workbook = XLSX.read(context.content, { type: "array" });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			context.addError({
				field: null,
				message: `Failed to parse Excel file: ${message}`,
				originalValue: null,
			});
			return { rows: [], totalRows: 0 };
		}

		// Select sheet
		let sheetName: string;
		if (opts.sheetNameOrIndex !== undefined) {
			if (typeof opts.sheetNameOrIndex === "number") {
				if (opts.sheetNameOrIndex >= workbook.SheetNames.length) {
					context.addError({
						field: null,
						message: `Sheet index ${opts.sheetNameOrIndex} not found. Workbook has ${workbook.SheetNames.length} sheets.`,
						originalValue: null,
					});
					return { rows: [], totalRows: 0 };
				}
				sheetName = workbook.SheetNames[opts.sheetNameOrIndex];
			} else {
				if (!workbook.SheetNames.includes(opts.sheetNameOrIndex)) {
					context.addError({
						field: null,
						message: `Sheet "${opts.sheetNameOrIndex}" not found. Available sheets: ${workbook.SheetNames.join(", ")}`,
						originalValue: null,
					});
					return { rows: [], totalRows: 0 };
				}
				sheetName = opts.sheetNameOrIndex;
			}
		} else {
			sheetName = workbook.SheetNames[0];
		}

		const sheet = workbook.Sheets[sheetName];
		if (!sheet) {
			context.addError({
				field: null,
				message: "Failed to access worksheet",
				originalValue: null,
			});
			return { rows: [], totalRows: 0 };
		}

		// Convert sheet to array of arrays
		const rawData = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
			header: 1,
			defval: "",
			blankrows: false,
		});

		if (rawData.length === 0) {
			context.addWarning({ field: null, message: "Excel file is empty" });
			return { rows: [], totalRows: 0 };
		}

		// Extract headers if present
		let headers: string[] = [];
		let dataStartRow = opts.headerRowCount;

		if (opts.hasHeader) {
			const headerRow = rawData[0] as unknown[];
			headers = headerRow.map((cell) => String(cell ?? "").trim());
			if (dataStartRow === 0) {
				dataStartRow = 1;
			}
		}

		// Build column index mapping
		const columnIndices = this.buildColumnIndices(
			headers,
			opts.columnMapping,
			context,
		);

		// No column mapping provided - cannot map to NormalizedRow
		if (!columnIndices) {
			context.addError({
				field: null,
				message:
					"No column mapping provided. Cannot map Excel columns to normalized fields.",
				originalValue: null,
			});
			return { rows: [], totalRows: rawData.length - dataStartRow };
		}

		const rows: NormalizedRow[] = [];
		const totalRows = rawData.length - dataStartRow;

		for (let i = dataStartRow; i < rawData.length; i++) {
			const rawRow = rawData[i] as unknown[];
			const rowNumber = i + 1; // 1-based for user-facing

			// Skip empty rows
			if (
				opts.skipEmptyRows &&
				rawRow.every(
					(cell) => cell === "" || cell === null || cell === undefined,
				)
			) {
				continue;
			}

			const normalizedRow = this.mapRowToNormalized(
				rawRow,
				rowNumber,
				columnIndices,
				opts.defaultStoreIdentifier ?? "",
				context,
			);

			if (normalizedRow) {
				// Validate required fields
				const validationErrors = this.validateRequiredFields(normalizedRow);
				if (validationErrors.length > 0) {
					for (const error of validationErrors) {
						context.addError({
							rowNumber,
							field: null,
							message: error,
							originalValue: JSON.stringify(rawRow),
						});
					}
					if (context.options.skipInvalid) {
						continue;
					}
				}
				rows.push(normalizedRow);
			}
		}

		return { rows, totalRows };
	}

	/**
	 * Build column indices from headers or numeric indices.
	 */
	private buildColumnIndices(
		headers: string[],
		mapping: XlsxColumnMapping | undefined,
		context: ParseContext,
	): Map<string, number> | null {
		if (!mapping) {
			return null;
		}

		const indices = new Map<string, number>();

		const resolveIndex = (
			field: string,
			value: number | string | undefined,
		): number | undefined => {
			if (value === undefined) {
				return undefined;
			}

			if (typeof value === "number") {
				return value;
			}

			// It's a header name - find the index
			const idx = headers.findIndex(
				(h) => h.toLowerCase().trim() === value.toLowerCase().trim(),
			);
			if (idx === -1) {
				context.addWarning({
					field: null,
					message: `Column "${value}" for field "${field}" not found in headers`,
				});
				return undefined;
			}
			return idx;
		};

		// Map all fields
		const fields: (keyof XlsxColumnMapping)[] = [
			"storeIdentifier",
			"externalId",
			"name",
			"description",
			"category",
			"subcategory",
			"brand",
			"unit",
			"unitQuantity",
			"price",
			"discountPrice",
			"discountStart",
			"discountEnd",
			"barcodes",
			"imageUrl",
		];

		for (const field of fields) {
			const idx = resolveIndex(field, mapping[field]);
			if (idx !== undefined) {
				indices.set(field, idx);
			}
		}

		// Check required fields
		if (!indices.has("name")) {
			context.addError({
				field: "name",
				message: "Column mapping missing required field: name",
				originalValue: null,
			});
			return null;
		}
		if (!indices.has("price")) {
			context.addError({
				field: "price",
				message: "Column mapping missing required field: price",
				originalValue: null,
			});
			return null;
		}

		return indices;
	}

	/**
	 * Map a raw spreadsheet row to NormalizedRow.
	 */
	private mapRowToNormalized(
		rawRow: unknown[],
		rowNumber: number,
		columnIndices: Map<string, number>,
		defaultStoreIdentifier: string,
		context: ParseContext,
	): NormalizedRow | null {
		const getValue = (field: string): string | null => {
			const idx = columnIndices.get(field);
			if (idx === undefined || idx >= rawRow.length) {
				return null;
			}
			const value = rawRow[idx];
			if (value === null || value === undefined || value === "") {
				return null;
			}
			return String(value).trim();
		};

		const getNumericValue = (field: string): number | null => {
			const idx = columnIndices.get(field);
			if (idx === undefined || idx >= rawRow.length) {
				return null;
			}
			const value = rawRow[idx];
			if (value === null || value === undefined || value === "") {
				return null;
			}
			// If it's already a number (common in Excel), use it directly
			if (typeof value === "number") {
				return value;
			}
			return null;
		};

		const getDateValue = (field: string): Date | null => {
			const idx = columnIndices.get(field);
			if (idx === undefined || idx >= rawRow.length) {
				return null;
			}
			const value = rawRow[idx];
			if (value === null || value === undefined || value === "") {
				return null;
			}
			// If it's already a Date (Excel can parse dates)
			if (value instanceof Date) {
				return value;
			}
			// If it's a number, treat it as Excel serial date
			if (typeof value === "number") {
				return this.excelDateToJS(value);
			}
			// Try parsing as string
			return this.parseDate(String(value));
		};

		// Parse price - prefer numeric value from Excel
		let price = 0;
		const numericPrice = getNumericValue("price");
		if (numericPrice !== null) {
			// Convert to cents
			price = Math.round(numericPrice * 100);
		} else {
			const priceStr = getValue("price");
			if (priceStr) {
				price = this.parsePrice(priceStr);
				if (Number.isNaN(price)) {
					context.addError({
						rowNumber,
						field: "price",
						message: "Invalid price value",
						originalValue: priceStr,
					});
					price = 0;
				}
			}
		}

		// Parse discount price
		let discountPrice: number | null = null;
		const numericDiscountPrice = getNumericValue("discountPrice");
		if (numericDiscountPrice !== null) {
			discountPrice = Math.round(numericDiscountPrice * 100);
		} else {
			const discountPriceStr = getValue("discountPrice");
			if (discountPriceStr) {
				discountPrice = this.parsePrice(discountPriceStr);
				if (Number.isNaN(discountPrice)) {
					context.addWarning({
						rowNumber,
						field: "discountPrice",
						message: "Invalid discount price value, ignoring",
					});
					discountPrice = null;
				}
			}
		}

		// Parse dates
		const discountStart = getDateValue("discountStart");
		const discountEnd = getDateValue("discountEnd");

		// Parse barcodes
		const barcodesStr = getValue("barcodes");
		const barcodes = barcodesStr
			? barcodesStr
					.split(",")
					.map((b) => b.trim())
					.filter((b) => b !== "")
			: [];

		// Get store identifier
		const storeIdentifier =
			getValue("storeIdentifier") ?? defaultStoreIdentifier;

		const row: NormalizedRow = {
			storeIdentifier,
			externalId: getValue("externalId"),
			name: getValue("name") ?? "",
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
			rawData: JSON.stringify(rawRow),
		};

		return row;
	}

	/**
	 * Convert Excel serial date to JavaScript Date.
	 * Excel dates are stored as days since 1900-01-01 (with a bug for 1900 leap year).
	 */
	private excelDateToJS(serial: number): Date | null {
		if (serial < 1) {
			return null;
		}

		// Excel incorrectly treats 1900 as a leap year
		// Dates after Feb 28, 1900 need adjustment
		const adjustedSerial = serial > 59 ? serial - 1 : serial;

		// Excel epoch is Jan 1, 1900 (but it's actually Dec 31, 1899 due to the bug)
		const excelEpoch = new Date(Date.UTC(1899, 11, 31));
		const msPerDay = 24 * 60 * 60 * 1000;
		const date = new Date(excelEpoch.getTime() + adjustedSerial * msPerDay);

		return Number.isNaN(date.getTime()) ? null : date;
	}

	/**
	 * Parse a price string to cents (integer).
	 * Handles various formats: "12.99", "12,99", "1.299,00"
	 */
	private parsePrice(value: string): number {
		// Remove currency symbols and whitespace
		let cleaned = value.replace(/[€$£\s]/g, "");

		// Determine decimal separator
		// If there's a comma after a dot, comma is decimal separator (European)
		// If there's a dot after a comma, dot is decimal separator (US)
		const lastDot = cleaned.lastIndexOf(".");
		const lastComma = cleaned.lastIndexOf(",");

		if (lastComma > lastDot) {
			// European format: 1.234,56 -> comma is decimal
			cleaned = cleaned.replace(/\./g, "").replace(",", ".");
		} else if (lastDot > lastComma) {
			// US format: 1,234.56 -> just remove commas
			cleaned = cleaned.replace(/,/g, "");
		}

		const parsed = parseFloat(cleaned);
		if (Number.isNaN(parsed)) {
			return NaN;
		}

		// Convert to cents
		return Math.round(parsed * 100);
	}

	/**
	 * Parse a date string to Date object.
	 * Supports various formats: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY
	 */
	private parseDate(value: string | null): Date | null {
		if (!value) {
			return null;
		}

		// Try ISO format first (YYYY-MM-DD)
		const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (isoMatch) {
			const date = new Date(
				parseInt(isoMatch[1], 10),
				parseInt(isoMatch[2], 10) - 1,
				parseInt(isoMatch[3], 10),
			);
			return Number.isNaN(date.getTime()) ? null : date;
		}

		// European format (DD.MM.YYYY or DD/MM/YYYY)
		const euMatch = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
		if (euMatch) {
			const date = new Date(
				parseInt(euMatch[3], 10),
				parseInt(euMatch[2], 10) - 1,
				parseInt(euMatch[1], 10),
			);
			return Number.isNaN(date.getTime()) ? null : date;
		}

		return null;
	}
}

/**
 * Create an XLSX parser with column mapping.
 * @param columnMapping - Column mapping configuration
 * @param defaultStoreIdentifier - Default store identifier
 * @returns Configured XlsxParser instance
 */
export function createXlsxParser(
	columnMapping: XlsxColumnMapping,
	defaultStoreIdentifier?: string,
): XlsxParser {
	return new XlsxParser({
		columnMapping,
		defaultStoreIdentifier,
		hasHeader: true,
	});
}

/**
 * Detect column headers from an Excel file.
 * Useful for auto-discovering column mapping.
 * @param content - Excel file content as ArrayBuffer
 * @param sheetNameOrIndex - Sheet to read headers from (default: first sheet)
 * @returns Array of header strings, or null if parsing fails
 */
export function detectXlsxHeaders(
	content: ArrayBuffer,
	sheetNameOrIndex?: string | number,
): string[] | null {
	try {
		const workbook = XLSX.read(content, { type: "array" });

		let sheetName: string;
		if (sheetNameOrIndex !== undefined) {
			if (typeof sheetNameOrIndex === "number") {
				if (sheetNameOrIndex >= workbook.SheetNames.length) {
					return null;
				}
				sheetName = workbook.SheetNames[sheetNameOrIndex];
			} else {
				if (!workbook.SheetNames.includes(sheetNameOrIndex)) {
					return null;
				}
				sheetName = sheetNameOrIndex;
			}
		} else {
			sheetName = workbook.SheetNames[0];
		}

		const sheet = workbook.Sheets[sheetName];
		if (!sheet) {
			return null;
		}

		const rawData = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
			header: 1,
			defval: "",
			range: 0,
		});

		if (rawData.length === 0) {
			return null;
		}

		const headerRow = rawData[0] as unknown[];
		return headerRow
			.map((cell) => String(cell ?? "").trim())
			.filter((h) => h !== "");
	} catch {
		return null;
	}
}

/**
 * Get list of sheet names from an Excel file.
 * @param content - Excel file content as ArrayBuffer
 * @returns Array of sheet names, or null if parsing fails
 */
export function getXlsxSheetNames(content: ArrayBuffer): string[] | null {
	try {
		const workbook = XLSX.read(content, { type: "array" });
		return workbook.SheetNames;
	} catch {
		return null;
	}
}
