export type FileType = "csv" | "xml" | "xlsx" | "zip";

export type PriceStatus = "available" | "unavailable";
export type PriceUnavailableReason = "missing" | "invalid" | "non_positive";

export interface NormalizedRow {
	storeIdentifier: string;
	externalId?: string;
	name: string;
	description?: string;
	category?: string;
	subcategory?: string;
	brand?: string;
	unit?: string;
	unitQuantity?: string;
	price: number | null;
	priceStatus: PriceStatus;
	priceUnavailableReason?: PriceUnavailableReason;
	discountPrice?: number;
	discountStart?: Date;
	discountEnd?: Date;
	barcodes: string[];
	imageUrl?: string;
	rowNumber: number;
	rawData: string;
	unitPrice?: number;
	unitPriceBaseQuantity?: string;
	unitPriceBaseUnit?: string;
	lowestPrice30d?: number;
	anchorPrice?: number;
	anchorPriceAsOf?: Date;
}

export interface NormalizedRowValidation {
	isValid: boolean;
	errors: string[];
	warnings: string[];
}

export interface StoreIdentifier {
	type: string;
	value: string;
}

export interface StoreMetadata {
	name: string;
	address?: string;
	city?: string;
	postalCode?: string;
	storeType?: string;
}

export interface StoreDescriptor {
	id: string;
	chainSlug: string;
	name: string;
	address?: string;
	city?: string;
	postalCode?: string;
	latitude?: string;
	longitude?: string;
}

export interface StoreResolutionResult {
	found: boolean;
	store?: StoreDescriptor;
	matchedIdentifier?: StoreIdentifier;
	attemptedIdentifiers?: StoreIdentifier[];
}

export interface DiscoveredFile {
	url: string;
	filename: string;
	type: FileType;
	size?: number;
	lastModified?: Date;
	metadata?: Record<string, string>;
}

export interface FetchedFile {
	discovered: DiscoveredFile;
	content: Buffer;
	hash: string;
}

export interface ExpandedFile {
	parent: DiscoveredFile;
	innerFilename: string;
	type: FileType;
	content: Buffer;
	hash: string;
}

export interface ParseOptions {
	skipInvalid?: boolean;
	limit?: number;
}

export interface ParseError {
	rowNumber?: number;
	field?: string;
	message: string;
	originalValue?: string;
}

export interface ParseWarning {
	rowNumber?: number;
	field?: string;
	message: string;
}

export interface ParseResult {
	rows: NormalizedRow[];
	errors: ParseError[];
	warnings: ParseWarning[];
	totalRows: number;
	validRows: number;
}

export function stringPtr(value?: string): string | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	return value;
}

export function intPtr(value?: number): number | undefined {
	if (value === undefined || Number.isNaN(value)) {
		return undefined;
	}
	return value;
}
