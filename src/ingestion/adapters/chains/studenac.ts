import { okAsync, Result, ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "@/lib/errors";
import type { IngestionClassified } from "../../errors";
import type { XmlFieldMapping } from "../../parsers/xml";
import { expandZip } from "../../parsers/zip";
import type {
	DiscoveredFile,
	ExpandedFile,
	ParseOptions,
	ParseResult,
	StoreMetadata,
} from "../../types";
import { BaseXmlAdapter } from "../base/xml";
import { chainConfigs } from "../config";

const studenacFieldMapping: XmlFieldMapping = {
	externalId: "code",
	name: "name",
	description: "description",
	category: "category",
	subcategory: "subcategory",
	brand: "brand",
	unit: "unit",
	unitQuantity: "quantity",
	price: "price",
	priceExtractor: (item) =>
		extractPriceWithFallback(item, "price", "discount_price"),
	discountPrice: "discount_price",
	discountStart: "discount_start",
	discountEnd: "discount_end",
	barcodes: "barcode",
	imageUrl: "image_url",
	unitPrice: "unit_price",
	unitPriceBaseQuantity: "unit_price_quantity",
	unitPriceBaseUnit: "unit_price_unit",
	lowestPrice30d: "lowest_price_30d",
	anchorPrice: "anchor_price",
	anchorPriceAsOf: "anchor_price_date",
};

const studenacFieldMappingAlt: XmlFieldMapping = {
	externalId: "SifraProizvoda",
	name: "NazivProizvoda",
	description: undefined,
	category: "KategorijeProizvoda",
	subcategory: undefined,
	brand: "MarkaProizvoda",
	unit: "JedinicaMjere",
	unitQuantity: undefined,
	price: "MaloprodajnaCijena",
	priceExtractor: (item) =>
		extractPriceWithFallback(
			item,
			"MaloprodajnaCijena",
			"MaloprodajnaCijenaAkcija",
		),
	discountPrice: "MaloprodajnaCijenaAkcija",
	discountStart: undefined,
	discountEnd: undefined,
	barcodes: "Barkod",
	imageUrl: undefined,
	unitPrice: "CijenaZaJedinicuMjere",
	unitPriceBaseQuantity: undefined,
	unitPriceBaseUnit: undefined,
	lowestPrice30d: "NajnizaCijena",
	anchorPrice: "SidrenaCijena",
	anchorPriceAsOf: undefined,
};

export class StudenacAdapter extends BaseXmlAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.studenac;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^Studenac[_-]?",
					"(?i)^cjenik[_-]?",
					"(?i)^SUPERMARKET[_-]?",
				],
			},
			fieldMapping: studenacFieldMapping,
			alternativeFieldMapping: studenacFieldMappingAlt,
			defaultItemsPath: "Proizvodi.ProdajniObjekt.Proizvodi.Proizvod",
			itemPaths: [
				"Proizvodi.ProdajniObjekt.Proizvodi.Proizvod",
				"Proizvodi.prodajniobjekt.proizvodi.proizvod",
			],
		});
	}

	setDiscoveryDate(date: string): void {
		this.discoveryDate = date;
	}

	discover(
		targetDate?: string,
	): ResultAsync<DiscoveredFile[], FetchError | IngestionClassified> {
		const discovered: DiscoveredFile[] = [];
		const seen = new Set<string>();
		let filterDate = targetDate || this.discoveryDate;
		if (!filterDate) {
			filterDate = new Date().toISOString().slice(0, 10);
		}

		return this.fetchWithRetry(this.baseUrl())
			.andThen((response) =>
				ResultAsync.fromPromise(response.text(), (e) =>
					fetchError({
						url: this.baseUrl(),
						message: e instanceof Error ? e.message : "Failed to read response",
						retryable: false,
						attempts: 1,
						cause: e,
					}),
				),
			)
			.andThen((html) => {
				const pattern = /href=["']([^"']*\.zip(?:\?[^"']*)?)["']/gi;
				let match: RegExpExecArray | null;
				while ((match = pattern.exec(html)) !== null) {
					const href = match[1];
					const fileUrl = this.resolveUrl(href);
					if (seen.has(fileUrl)) {
						continue;
					}
					seen.add(fileUrl);
					const filenameResult = this.extractFilenameFromUrl(fileUrl);
					const filename = filenameResult.isErr() ? fileUrl : filenameResult.value;
					const fileDate = this.extractDateFromFilename(filename);
					if (filterDate && fileDate && fileDate !== filterDate) {
						continue;
					}
					const lastModified = fileDate ? new Date(fileDate) : undefined;
					discovered.push({
						url: fileUrl,
						filename,
						type: "zip",
						lastModified,
						metadata: {
							source: "studenac_portal",
							discoveredAt: new Date().toISOString(),
							portalDate: fileDate,
						},
					});
				}

				return okAsync(discovered);
			});
	}

	parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError> {
		return super.parse(content, filename, options).map((result) => {
			const storeId = this.extractStoreIdentifierFromFilename(filename);

			for (const row of result.rows) {
				if (!row.storeIdentifier && storeId) {
					row.storeIdentifier = storeId;
				}
				// Fallback rows use akcija as the main price; treat equal/higher discount
				// values as invalid discount metadata instead of producing warnings.
				if (
					row.price !== null &&
					row.discountPrice !== undefined &&
					row.discountPrice >= row.price
				) {
					row.discountPrice = undefined;
				}
			}

			return result;
		});
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const baseName = filename.replace(/\.(xml|XML)$/i, "");

		// Preferred format: `...-T1234-...`
		const withT = baseName.match(/-T(\d+)-/);
		if (withT?.[1]) return withT[1];

		// Alternative format observed on staging: `...-1234-275-2026-02-13-...`
		const withoutT = baseName.match(/-(\d+)-\d{3}-\d{4}-\d{2}-\d{2}-/);
		if (withoutT?.[1]) return withoutT[1];

		return super.extractStoreIdentifierFromFilename(filename);
	}

	private resolveUrl(href: string): string {
		if (href.startsWith("http://") || href.startsWith("https://")) {
			return href;
		}
		const base = new URL(this.baseUrl());
		if (href.startsWith("/")) {
			return `${base.protocol}//${base.host}${href}`;
		}
		return `${this.baseUrl()}/${href}`;
	}

	async expandZip(content: Buffer, filename: string): Promise<ExpandedFile[]> {
		const expandedResult = await expandZip(content, filename);
		if (expandedResult.isErr()) {
			return [];
		}
		return expandedResult.value.filter((file) => file.type === "xml");
	}

	protected extractFilenameFromUrl(fileUrl: string): Result<string, Error> {
		return Result.fromThrowable(
			() => {
				const parsed = new URL(fileUrl);
				const parts = parsed.pathname.split("/");
				return parts[parts.length - 1] ?? fileUrl;
			},
			(e) => new Error(`Failed to extract filename from URL ${fileUrl}: ${e instanceof Error ? e.message : String(e)}`),
		)();
	}

	private extractDateFromFilename(filename: string): string {
		const isoMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
		if (isoMatch) {
			return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
		}
		const euMatch = filename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
		if (euMatch) {
			return `${euMatch[3]}-${euMatch[2]}-${euMatch[1]}`;
		}
		return "";
	}

	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
		const identifier = this.extractStoreIdentifierFromFilename(file.filename);
		if (!identifier) {
			return null;
		}

		const baseName = file.filename.replace(/\.(xml|XML)$/i, "");

		const match = baseName.match(
			/^SUPERMARKET-(.+)-(?:T)?\d+-\d+-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d+/i,
		);
		if (match?.[1]) {
			const locationPart = match[1];
			const parts = locationPart
				.split("_")
				.map((p) => p.trim())
				.filter(Boolean);

			if (parts.length >= 2) {
				const splitIndex = getStreetCitySplitIndex(parts);
				const streetParts = parts.slice(0, splitIndex);
				const cityParts = parts.slice(splitIndex);

				const street = streetParts.join(" ").replace(/\s+/g, " ").trim();
				const city = cityParts.join(" ").replace(/\s+/g, " ").trim();

				if (city) {
					return {
						name: `${this.name} ${city}`,
						address: street || undefined,
						city: city,
					};
				}
			}

			if (parts.length === 1) {
				const city = parts[0]?.trim() ?? "";
				if (city) {
					return {
						name: `${this.name} ${city}`,
						city: city,
					};
				}
			}
		}

		return {
			name: `${this.name} ${identifier}`,
		};
	}
}

function extractPriceWithFallback(
	item: Record<string, unknown>,
	regularKey: string,
	fallbackKey: string,
): string {
	const regularPrice = valueFromRecord(item, regularKey);
	if (regularPrice) {
		return regularPrice;
	}
	return valueFromRecord(item, fallbackKey);
}

function getStreetCitySplitIndex(parts: string[]): number {
	for (let index = parts.length - 2; index >= 0; index -= 1) {
		const part = parts[index];
		if (/^\d+[A-Za-z]?$/i.test(part)) {
			return index + 1;
		}
	}
	return 1;
}

function valueFromRecord(record: Record<string, unknown>, key: string): string {
	return unknownToString(record[key]);
}

function unknownToString(value: unknown): string {
	if (typeof value === "string") {
		return value.trim();
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			const converted = unknownToString(entry);
			if (converted) {
				return converted;
			}
		}
		return "";
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const textValue =
			record["#text"] ?? record._text ?? record["."] ?? record[""];
		if (textValue !== undefined) {
			return unknownToString(textValue);
		}
		for (const nested of Object.values(record)) {
			const converted = unknownToString(nested);
			if (converted) {
				return converted;
			}
		}
	}
	return "";
}
