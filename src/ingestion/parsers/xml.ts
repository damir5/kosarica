import { XMLParser } from "fast-xml-parser";
import type { NormalizedRow, ParseError, ParseResult } from "../types";
import { decode, detectEncoding, type Encoding } from "./charset";
import { parsePrice } from "./price";

export type FieldExtractor = (item: Record<string, unknown>) => string;
export type BarcodeExtractor = (item: Record<string, unknown>) => string[];

export interface XmlFieldMapping {
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
	nameExtractor?: FieldExtractor;
	priceExtractor?: FieldExtractor;
	barcodesExtractor?: BarcodeExtractor;
}

export interface XmlParserOptions {
	itemsPath?: string;
	fieldMapping: XmlFieldMapping;
	defaultStoreIdentifier?: string;
	encoding?: Encoding | "auto";
	attributePrefix?: string;
}

export class XmlParser {
	private options: XmlParserOptions;
	private alternativeMapping?: XmlFieldMapping;

	constructor(options: XmlParserOptions) {
		this.options = {
			attributePrefix: "@_",
			encoding: "auto",
			...options,
		};
	}

	setAlternativeMapping(mapping?: XmlFieldMapping): void {
		this.alternativeMapping = mapping;
	}

	parse(content: Buffer): ParseResult {
		return this.parseWithStoreId(content, "");
	}

	parseWithStoreId(content: Buffer, storeId: string): ParseResult {
		const decoded = this.decodeContent(content);
		const data = parseXmlToObject(
			decoded,
			this.options.attributePrefix ?? "@_",
		);

		const itemsPath = this.options.itemsPath;
		let items: unknown[] | null = null;
		if (itemsPath) {
			items = getItemsAtPath(data, itemsPath);
		} else {
			const commonPaths = [
				"products.product",
				"Products.Product",
				"items.item",
				"Items.Item",
				"data.product",
				"Data.Product",
				"Cjenik.Proizvod",
				"cjenik.proizvod",
			];
			for (const path of commonPaths) {
				items = getItemsAtPath(data, path);
				if (items) {
					break;
				}
			}
		}

		if (!items) {
			return {
				rows: [],
				errors: [{ message: "Could not find items path in XML" }],
				warnings: [],
				totalRows: 0,
				validRows: 0,
			};
		}

		const result = parseItems(items, this.options.fieldMapping, storeId);
		if (result.validRows === 0 && this.alternativeMapping) {
			return parseItems(items, this.alternativeMapping, storeId);
		}
		return result;
	}

	parseWithItemsPath(
		content: Buffer,
		itemsPath: string,
		mapping: XmlFieldMapping,
		storeId: string,
	): ParseResult {
		const decoded = this.decodeContent(content);
		const data = parseXmlToObject(
			decoded,
			this.options.attributePrefix ?? "@_",
		);
		const items = getItemsAtPath(data, itemsPath);
		if (!items) {
			return {
				rows: [],
				errors: [{ message: `Failed to get items at path ${itemsPath}` }],
				warnings: [],
				totalRows: 0,
				validRows: 0,
			};
		}

		return parseItems(items, mapping, storeId);
	}

	private decodeContent(content: Buffer): string {
		if (
			content.length >= 3 &&
			content[0] === 0xef &&
			content[1] === 0xbb &&
			content[2] === 0xbf
		) {
			return content.slice(3).toString("utf-8");
		}

		const declared = detectEncodingFromDeclaration(content);
		const encoding =
			this.options.encoding === "auto" || !this.options.encoding
				? declared || detectEncoding(content)
				: this.options.encoding;

		try {
			return decode(content, encoding as Encoding);
		} catch {
			return content.toString("utf-8");
		}
	}
}

function parseXmlToObject(
	content: string,
	attributePrefix: string,
): Record<string, unknown> {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: attributePrefix,
		textNodeName: "#text",
		trimValues: true,
		parseTagValue: false,
		parseAttributeValue: false,
	});

	const parsed = parser.parse(content);
	return typeof parsed === "object" && parsed !== null
		? (parsed as Record<string, unknown>)
		: {};
}

function detectEncodingFromDeclaration(content: Buffer): Encoding | "" {
	const slice = content
		.slice(0, Math.min(content.length, 200))
		.toString("ascii");
	const match = slice.match(/<\?xml[^?]*encoding=["']([^"']+)["'][^?]*\?>/i);
	if (!match) {
		return "";
	}
	const encoding = match[1].toLowerCase();
	if (encoding === "windows-1250" || encoding === "cp1250") {
		return "windows-1250";
	}
	if (encoding === "iso-8859-2" || encoding === "latin2") {
		return "iso-8859-2";
	}
	if (encoding === "utf-8" || encoding === "utf8") {
		return "utf-8";
	}
	return "";
}

function getItemsAtPath(
	data: Record<string, unknown>,
	path: string,
): unknown[] | null {
	const parts = path.split(".");
	let current: unknown = data;
	for (const part of parts) {
		if (typeof current !== "object" || current === null) {
			return null;
		}
		const record = current as Record<string, unknown>;
		let next = record[part];
		if (next === undefined) {
			const matchKey = Object.keys(record).find(
				(key) => key.toLowerCase() === part.toLowerCase(),
			);
			if (matchKey) {
				next = record[matchKey];
			}
		}
		if (next === undefined) {
			return null;
		}
		current = next;
	}

	if (Array.isArray(current)) {
		return current;
	}
	if (current && typeof current === "object") {
		return [current];
	}
	return null;
}

function parseItems(
	items: unknown[],
	mapping: XmlFieldMapping,
	storeId: string,
): ParseResult {
	const result: ParseResult = {
		rows: [],
		errors: [],
		warnings: [],
		totalRows: 0,
		validRows: 0,
	};

	items.forEach((item, index) => {
		const rowNumber = index + 1;
		const mapped = mapItemToRow(item, rowNumber, mapping, storeId);
		result.totalRows += 1;
		if (mapped.errors.length > 0 || !mapped.row) {
			result.errors.push(...mapped.errors);
			return;
		}
		result.rows.push(mapped.row);
		result.validRows += 1;
	});

	return result;
}

function mapItemToRow(
	item: unknown,
	rowNumber: number,
	mapping: XmlFieldMapping,
	defaultStoreId: string,
): { row?: NormalizedRow; errors: ParseError[] } {
	const errors: ParseError[] = [];
	const record = (item ?? {}) as Record<string, unknown>;

	const extractString = (
		path?: string,
		extractor?: FieldExtractor,
	): string | undefined => {
		if (extractor) {
			const val = extractor(record);
			return val.trim() ? val : undefined;
		}
		if (!path) {
			return undefined;
		}
		return valueToString(getValueAtPath(record, path));
	};

	const name = mapping.nameExtractor
		? mapping.nameExtractor(record)
		: extractString(mapping.name);
	if (!name) {
		errors.push({ rowNumber, field: "name", message: "Name is required" });
	}

	let priceValue = "";
	if (mapping.priceExtractor) {
		priceValue = mapping.priceExtractor(record);
	} else {
		priceValue = extractString(mapping.price) ?? "";
	}

	let price = 0;
	if (!priceValue) {
		errors.push({ rowNumber, field: "price", message: "Price is required" });
	} else {
		try {
			price = parsePrice(priceValue);
		} catch {
			errors.push({
				rowNumber,
				field: "price",
				message: "Invalid price value",
				originalValue: priceValue,
			});
		}
	}

	if (errors.length > 0) {
		return { errors };
	}

	const storeIdentifier =
		extractString(mapping.storeIdentifier) ?? defaultStoreId;

	let barcodes: string[] = [];
	if (mapping.barcodesExtractor) {
		barcodes = mapping.barcodesExtractor(record);
	} else if (mapping.barcodes) {
		barcodes = extractBarcodes(record, mapping.barcodes);
	}

	const discountPrice = parseOptionalPrice(
		extractString(mapping.discountPrice),
	);
	const unitPrice = parseOptionalPrice(extractString(mapping.unitPrice));
	const lowestPrice30d = parseOptionalPrice(
		extractString(mapping.lowestPrice30d),
	);
	const anchorPrice = parseOptionalPrice(extractString(mapping.anchorPrice));

	const discountStart = parseDate(extractString(mapping.discountStart));
	const discountEnd = parseDate(extractString(mapping.discountEnd));
	const anchorPriceAsOf = parseDate(extractString(mapping.anchorPriceAsOf));

	const row: NormalizedRow = {
		storeIdentifier,
		externalId: extractString(mapping.externalId),
		name: name ?? "",
		description: extractString(mapping.description),
		category: extractString(mapping.category),
		subcategory: extractString(mapping.subcategory),
		brand: extractString(mapping.brand),
		unit: extractString(mapping.unit),
		unitQuantity: extractString(mapping.unitQuantity),
		price,
		discountPrice,
		discountStart,
		discountEnd,
		barcodes: barcodes ?? [],
		imageUrl: extractString(mapping.imageUrl),
		rowNumber,
		rawData: JSON.stringify(record),
		unitPrice,
		unitPriceBaseQuantity: extractString(mapping.unitPriceBaseQuantity),
		unitPriceBaseUnit: extractString(mapping.unitPriceBaseUnit),
		lowestPrice30d,
		anchorPrice,
		anchorPriceAsOf,
	};

	return { row, errors: [] };
}

function getValueAtPath(item: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = item;
	for (const part of parts) {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		const record = current as Record<string, unknown>;
		let next = record[part];
		if (next === undefined) {
			const key = Object.keys(record).find(
				(k) => k.toLowerCase() === part.toLowerCase(),
			);
			if (key) {
				next = record[key];
			}
		}
		if (next === undefined) {
			return undefined;
		}
		current = next;
	}
	return current;
}

function valueToString(value: unknown): string | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? trimmed : undefined;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const converted = valueToString(item);
			if (converted) {
				return converted;
			}
		}
		return undefined;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of ["#text", "_text", ".", ""]) {
			if (key in record) {
				const converted = valueToString(record[key]);
				if (converted) {
					return converted;
				}
			}
		}
		for (const key of Object.keys(record)) {
			const converted = valueToString(record[key]);
			if (converted) {
				return converted;
			}
		}
		return undefined;
	}
	return String(value);
}

function extractBarcodes(
	item: Record<string, unknown>,
	path: string,
): string[] {
	const value = getValueAtPath(item, path);
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value
			.map((entry) => valueToString(entry))
			.filter((entry): entry is string => Boolean(entry));
	}
	if (typeof value === "string") {
		return splitBarcodes(value);
	}
	if (typeof value === "object") {
		const converted = valueToString(value);
		return converted ? splitBarcodes(converted) : [];
	}
	const converted = valueToString(value);
	return converted ? splitBarcodes(converted) : [];
}

function splitBarcodes(value: string): string[] {
	return value
		.split(/[,;|]/)
		.map((part) => part.trim())
		.filter((part) => part !== "");
}

function parseOptionalPrice(value?: string): number | undefined {
	if (!value) {
		return undefined;
	}
	try {
		return parsePrice(value);
	} catch {
		return undefined;
	}
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
			regex: /^(\d{2})\.(\d{2})\.(\d{4})$/,
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
