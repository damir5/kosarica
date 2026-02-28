import * as XLSX from "xlsx";
import type {
	NormalizedRow,
	ParseError,
	ParseResult,
	ParseWarning,
	PriceStatus,
	PriceUnavailableReason,
} from "../types";
import { parsePrice } from "./price";

export interface XlsxColumnIndex {
	index?: number;
	header?: string;
}

export const invalidIndex = -1;

export function newNumericIndex(index: number): XlsxColumnIndex {
	return { index };
}

export function newHeaderIndex(header: string): XlsxColumnIndex {
	return { header };
}

export interface XlsxColumnMapping {
	storeIdentifier?: XlsxColumnIndex;
	externalId?: XlsxColumnIndex;
	name: XlsxColumnIndex;
	description?: XlsxColumnIndex;
	category?: XlsxColumnIndex;
	subcategory?: XlsxColumnIndex;
	brand?: XlsxColumnIndex;
	unit?: XlsxColumnIndex;
	unitQuantity?: XlsxColumnIndex;
	price: XlsxColumnIndex;
	discountPrice?: XlsxColumnIndex;
	discountStart?: XlsxColumnIndex;
	discountEnd?: XlsxColumnIndex;
	barcodes?: XlsxColumnIndex;
	imageUrl?: XlsxColumnIndex;
	unitPrice?: XlsxColumnIndex;
	unitPriceBaseQuantity?: XlsxColumnIndex;
	unitPriceBaseUnit?: XlsxColumnIndex;
	lowestPrice30d?: XlsxColumnIndex;
	anchorPrice?: XlsxColumnIndex;
	anchorPriceAsOf?: XlsxColumnIndex;
}

export interface XlsxParserOptions {
	columnMapping?: XlsxColumnMapping;
	hasHeader?: boolean;
	headerRowCount?: number;
	defaultStoreIdentifier?: string;
	skipEmptyRows?: boolean;
	sheetNameOrIndex?: string | number;
}

export class XlsxParser {
	private options: XlsxParserOptions;
	private altMapping?: XlsxColumnMapping;

	constructor(options: XlsxParserOptions) {
		this.options = {
			hasHeader: true,
			headerRowCount: 0,
			skipEmptyRows: true,
			...options,
		};
	}

	setOptions(options: XlsxParserOptions): void {
		this.options = { ...this.options, ...options };
	}

	setAlternativeMapping(mapping?: XlsxColumnMapping): void {
		this.altMapping = mapping;
	}

	parse(content: Buffer): ParseResult {
		return this.parseWithStoreId(
			content,
			this.options.defaultStoreIdentifier ?? "",
		);
	}

	parseWithStoreId(content: Buffer, defaultStoreId: string): ParseResult {
		const primary = this.parseWithMapping(
			content,
			this.options.columnMapping,
			defaultStoreId,
		);
		if (primary.validRows === 0 && this.altMapping) {
			const alt = this.parseWithMapping(
				content,
				this.altMapping,
				defaultStoreId,
			);
			if (alt.validRows > 0) {
				return alt;
			}
		}
		return primary;
	}

	private parseWithMapping(
		content: Buffer,
		mapping: XlsxColumnMapping | undefined,
		defaultStoreId: string,
	): ParseResult {
		const result: ParseResult = {
			rows: [],
			errors: [],
			warnings: [],
			totalRows: 0,
			validRows: 0,
		};

		let workbook: XLSX.WorkBook;
		try {
			workbook = XLSX.read(content, { type: "buffer", cellDates: true });
		} catch (error) {
			result.errors.push({
				message: `Failed to parse Excel file: ${String(error)}`,
			});
			return result;
		}

		const sheetName = selectSheet(workbook, this.options.sheetNameOrIndex);
		if (!sheetName) {
			result.errors.push({ message: "Workbook has no sheets" });
			return result;
		}

		const sheet = workbook.Sheets[sheetName];
		const rows = XLSX.utils.sheet_to_json(sheet, {
			header: 1,
			defval: "",
			raw: true,
		}) as unknown[][];

		if (!rows || rows.length === 0) {
			result.warnings.push({ message: "Excel file is empty" });
			return result;
		}

		let headers: string[] = [];
		let dataStartRow = this.options.headerRowCount ?? 0;
		if (this.options.hasHeader) {
			headers = (rows[0] ?? []).map((cell) => cellToString(cell).trim());
			if (dataStartRow === 0) {
				dataStartRow = 1;
			}
		}

		result.totalRows = Math.max(0, rows.length - dataStartRow);

		if (!mapping) {
			result.errors.push({
				message:
					"No column mapping provided. Cannot map Excel columns to normalized fields.",
			});
			return result;
		}

		const indices = buildColumnIndices(headers, mapping);
		if (typeof indices === "string") {
			result.errors.push({ message: indices });
			return result;
		}

		for (let i = dataStartRow; i < rows.length; i += 1) {
			const rawRow = rows[i];
			const rowNumber = i + 1;

			if (this.options.skipEmptyRows && isEmptyRow(rawRow)) {
				continue;
			}

			const mapped = mapRowToNormalized(
				rawRow,
				rowNumber,
				indices,
				defaultStoreId,
			);
			result.errors.push(...mapped.errors);
			result.warnings.push(...mapped.warnings);
			if (mapped.row) {
				const validationErrors = validateRequiredFields(mapped.row);
				if (validationErrors.length > 0) {
					for (const errorMessage of validationErrors) {
						result.errors.push({
							rowNumber,
							message: errorMessage,
							originalValue: JSON.stringify(rawRow),
						});
					}
					continue;
				}
				result.rows.push(mapped.row);
			}
		}

		result.validRows = result.rows.length;
		return result;
	}
}

function selectSheet(
	workbook: XLSX.WorkBook,
	sheetNameOrIndex?: string | number,
): string | null {
	const sheetList = workbook.SheetNames;
	if (sheetList.length === 0) {
		return null;
	}
	if (sheetNameOrIndex === undefined || sheetNameOrIndex === null) {
		return sheetList[0];
	}
	if (typeof sheetNameOrIndex === "number") {
		return sheetList[sheetNameOrIndex] ?? null;
	}
	return sheetList.find((name) => name === sheetNameOrIndex) ?? null;
}

function buildColumnIndices(
	headers: string[],
	mapping: XlsxColumnMapping,
): ResolvedColumnIndices | string {
	const resolveIndex = (col?: XlsxColumnIndex): number => {
		if (!col) {
			return invalidIndex;
		}
		if (typeof col.index === "number") {
			return col.index;
		}
		if (col.header) {
			const headerLower = col.header.trim().toLowerCase();
			const idx = headers.findIndex(
				(header) => header.trim().toLowerCase() === headerLower,
			);
			return idx === -1 ? invalidIndex : idx;
		}
		return invalidIndex;
	};

	const indices: ResolvedColumnIndices = {
		storeIdentifier: resolveIndex(mapping.storeIdentifier),
		externalId: resolveIndex(mapping.externalId),
		name: resolveIndex(mapping.name),
		description: resolveIndex(mapping.description),
		category: resolveIndex(mapping.category),
		subcategory: resolveIndex(mapping.subcategory),
		brand: resolveIndex(mapping.brand),
		unit: resolveIndex(mapping.unit),
		unitQuantity: resolveIndex(mapping.unitQuantity),
		price: resolveIndex(mapping.price),
		discountPrice: resolveIndex(mapping.discountPrice),
		discountStart: resolveIndex(mapping.discountStart),
		discountEnd: resolveIndex(mapping.discountEnd),
		barcodes: resolveIndex(mapping.barcodes),
		imageUrl: resolveIndex(mapping.imageUrl),
		unitPrice: resolveIndex(mapping.unitPrice),
		unitPriceBaseQuantity: resolveIndex(mapping.unitPriceBaseQuantity),
		unitPriceBaseUnit: resolveIndex(mapping.unitPriceBaseUnit),
		lowestPrice30d: resolveIndex(mapping.lowestPrice30d),
		anchorPrice: resolveIndex(mapping.anchorPrice),
		anchorPriceAsOf: resolveIndex(mapping.anchorPriceAsOf),
	};

	if (indices.name === invalidIndex) {
		return "column mapping missing required field: name";
	}
	if (indices.price === invalidIndex) {
		return "column mapping missing required field: price";
	}

	return indices;
}

interface ResolvedColumnIndices {
	storeIdentifier: number;
	externalId: number;
	name: number;
	description: number;
	category: number;
	subcategory: number;
	brand: number;
	unit: number;
	unitQuantity: number;
	price: number;
	discountPrice: number;
	discountStart: number;
	discountEnd: number;
	barcodes: number;
	imageUrl: number;
	unitPrice: number;
	unitPriceBaseQuantity: number;
	unitPriceBaseUnit: number;
	lowestPrice30d: number;
	anchorPrice: number;
	anchorPriceAsOf: number;
}

function mapRowToNormalized(
	rawRow: unknown[],
	rowNumber: number,
	indices: ResolvedColumnIndices,
	defaultStoreId: string,
): { row?: NormalizedRow; errors: ParseError[]; warnings: ParseWarning[] } {
	const errors: ParseError[] = [];
	const warnings: ParseWarning[] = [];

	const getRawValue = (index: number): unknown => {
		if (index === invalidIndex || index >= rawRow.length) {
			return "";
		}
		return rawRow[index];
	};

	const getString = (index: number): string =>
		cellToString(getRawValue(index)).trim();
	const getOptionalString = (index: number): string | undefined => {
		const value = getString(index);
		return value ? value : undefined;
	};

	const priceStr = getString(indices.price);
	const discountStr = getString(indices.discountPrice);
	let price: number | null = null;
	let priceStatus: PriceStatus = "unavailable";
	let priceUnavailableReason: PriceUnavailableReason | undefined = "missing";
	let discountPrice: number | undefined;

	// Handle case where regular price is empty but discount price exists
	// This happens in some retailers (e.g., DM) where only the sale price is provided
	if (!priceStr && discountStr) {
		const priceResult = parsePrice(discountStr);
		if (priceResult.isOk() && priceResult.value > 0) {
			price = priceResult.value;
			priceStatus = "available";
			priceUnavailableReason = undefined;
		} else if (priceResult.isOk()) {
			priceUnavailableReason = "non_positive";
		} else {
			priceUnavailableReason = "invalid";
		}
		// Don't set discountPrice since we don't have the original price.
	} else {
		// Normal case: parse regular price
		if (priceStr) {
			const priceResult = parsePrice(priceStr);
			if (priceResult.isOk() && priceResult.value > 0) {
				price = priceResult.value;
				priceStatus = "available";
				priceUnavailableReason = undefined;
			} else if (priceResult.isOk()) {
				priceUnavailableReason = "non_positive";
			} else {
				priceUnavailableReason = "invalid";
			}
		}

		// Parse discount price if available
		if (discountStr) {
			const discountResult = parsePrice(discountStr);
			if (discountResult.isOk()) {
				discountPrice = discountResult.value;
			} else {
				warnings.push({
					rowNumber,
					field: "discountPrice",
					message: "Invalid discount price value, ignoring",
				});
			}
		}
	}

	if (priceStatus === "unavailable") {
		discountPrice = undefined;
	}

	const discountStart = parseDate(getRawValue(indices.discountStart));
	const discountEnd = parseDate(getRawValue(indices.discountEnd));

	let unitPrice: number | undefined;
	const unitPriceStr = getString(indices.unitPrice);
	if (unitPriceStr) {
		const unitPriceResult = parsePrice(unitPriceStr);
		if (unitPriceResult.isOk()) {
			unitPrice = unitPriceResult.value;
		} else {
			warnings.push({
				rowNumber,
				field: "unitPrice",
				message: "Invalid unit price value, ignoring",
			});
		}
	}

	let lowestPrice30d: number | undefined;
	const lowestPriceStr = getString(indices.lowestPrice30d);
	if (lowestPriceStr) {
		const lowestPriceResult = parsePrice(lowestPriceStr);
		if (lowestPriceResult.isOk()) {
			lowestPrice30d = lowestPriceResult.value;
		} else {
			warnings.push({
				rowNumber,
				field: "lowestPrice30d",
				message: "Invalid lowest price value, ignoring",
			});
		}
	}

	let anchorPrice: number | undefined;
	const anchorPriceStr = getString(indices.anchorPrice);
	if (anchorPriceStr) {
		const anchorPriceResult = parsePrice(anchorPriceStr);
		if (anchorPriceResult.isOk()) {
			anchorPrice = anchorPriceResult.value;
		} else {
			warnings.push({
				rowNumber,
				field: "anchorPrice",
				message: "Invalid anchor price value, ignoring",
			});
		}
	}

	const anchorPriceAsOf = parseDate(getRawValue(indices.anchorPriceAsOf));

	const storeIdentifier =
		getOptionalString(indices.storeIdentifier) ?? defaultStoreId;
	const name = getString(indices.name);
	if (!name) {
		errors.push({ rowNumber, field: "name", message: "Name is required" });
	}

	if (errors.length > 0) {
		return { errors, warnings };
	}

	const barcodesValue = getString(indices.barcodes);
	const barcodes = barcodesValue
		? barcodesValue
				.split(/[,;|]/)
				.map((part) => part.trim())
				.filter(Boolean)
		: [];

	const row: NormalizedRow = {
		storeIdentifier,
		externalId: getOptionalString(indices.externalId),
		name,
		description: getOptionalString(indices.description),
		category: getOptionalString(indices.category),
		subcategory: getOptionalString(indices.subcategory),
		brand: getOptionalString(indices.brand),
		unit: getOptionalString(indices.unit),
		unitQuantity: getOptionalString(indices.unitQuantity),
		price,
		priceStatus,
		priceUnavailableReason,
		discountPrice,
		discountStart,
		discountEnd,
		barcodes,
		imageUrl: getOptionalString(indices.imageUrl),
		rowNumber,
		rawData: JSON.stringify(rawRow),
		unitPrice,
		unitPriceBaseQuantity: getOptionalString(indices.unitPriceBaseQuantity),
		unitPriceBaseUnit: getOptionalString(indices.unitPriceBaseUnit),
		lowestPrice30d,
		anchorPrice,
		anchorPriceAsOf,
	};

	return { row, errors, warnings };
}

function validateRequiredFields(row: NormalizedRow): string[] {
	const errors: string[] = [];
	if (!row.name || row.name.trim() === "") {
		errors.push("Name is required");
	}
	return errors;
}

function isEmptyRow(row: unknown[]): boolean {
	return row.every((cell) => cellToString(cell).trim() === "");
}

function cellToString(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return String(value);
}

function parseDate(value: unknown): Date | undefined {
	if (value instanceof Date) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return excelDateToJs(value);
	}
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (isoMatch) {
		return new Date(
			Date.UTC(
				Number(isoMatch[1]),
				Number(isoMatch[2]) - 1,
				Number(isoMatch[3]),
			),
		);
	}

	const dotMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
	if (dotMatch) {
		return new Date(
			Date.UTC(
				Number(dotMatch[3]),
				Number(dotMatch[2]) - 1,
				Number(dotMatch[1]),
			),
		);
	}

	const slashMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (slashMatch) {
		return new Date(
			Date.UTC(
				Number(slashMatch[3]),
				Number(slashMatch[2]) - 1,
				Number(slashMatch[1]),
			),
		);
	}

	const parsed = Date.parse(trimmed);
	if (!Number.isNaN(parsed)) {
		return new Date(parsed);
	}

	return undefined;
}

function excelDateToJs(serial: number): Date {
	const serialInt = Math.floor(serial);
	const offset = serialInt > 59 ? serialInt - 1 : serialInt;
	const excelEpoch = Date.UTC(1899, 11, 31);
	return new Date(excelEpoch + offset * 24 * 60 * 60 * 1000);
}
