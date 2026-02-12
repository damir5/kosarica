import type { Result } from "neverthrow";
import { err, ok, ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "@/lib/errors";
import type { IngestionClassified } from "../../errors";
import type { CsvColumnMapping } from "../../parsers/csv";
import type {
	DiscoveredFile,
	ParseOptions,
	ParseResult,
	StoreMetadata,
} from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";

const konzumColumnMapping: CsvColumnMapping = {
	externalId: "ŠIFRA PROIZVODA",
	name: "NAZIV PROIZVODA",
	category: "KATEGORIJA PROIZVODA",
	brand: "MARKA PROIZVODA",
	unit: "JEDINICA MJERE",
	unitQuantity: "NETO KOLIČINA",
	price: "MALOPRODAJNA CIJENA",
	discountPrice: "MPC ZA VRIJEME POSEBNOG OBLIKA PRODAJE",
	barcodes: "BARKOD",
	unitPrice: "CIJENA ZA JEDINICU MJERE",
	lowestPrice30d: "NAJNIŽA CIJENA U ZADNJIH 30 DANA",
	anchorPrice: "SIDRENA CIJENA",
};

const konzumColumnMappingEN: CsvColumnMapping = {
	externalId: "Code",
	name: "Name",
	category: "Category",
	brand: "Brand",
	unit: "Unit",
	unitQuantity: "Quantity",
	price: "Price",
	discountPrice: "Discount Price",
	discountStart: "Discount Start",
	discountEnd: "Discount End",
	barcodes: "Barcode",
};

export class KonzumAdapter extends BaseCsvAdapter {
	constructor() {
		const chainConfig = chainConfigs.konzum;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: ["(?i)^Konzum[_-]?", "(?i)^cjenik[_-]?"],
			},
			columnMapping: konzumColumnMapping,
			alternativeColumnMapping: konzumColumnMappingEN,
		});
	}

	discover(
		targetDate?: string,
	): ResultAsync<DiscoveredFile[], FetchError | IngestionClassified> {
		return new ResultAsync(this.discoverImpl(targetDate));
	}

	private async discoverImpl(
		targetDate?: string,
	): Promise<Result<DiscoveredFile[], FetchError | IngestionClassified>> {
		const discovered: DiscoveredFile[] = [];
		const seen = new Set<string>();
		const date = targetDate || new Date().toISOString().slice(0, 10);
		const maxPages = 50;

		for (let page = 1; page <= maxPages; page += 1) {
			const pageUrl = `${this.baseUrl()}?date=${date}&page=${page}`;
			const responseResult = await this.fetchWithRetry(pageUrl);
			if (responseResult.isErr()) {
				if (responseResult.error.status) {
					break;
				}
				return err(responseResult.error);
			}
			const response = responseResult.value;
			let html = "";
			try {
				html = await response.text();
			} catch (error) {
				return err(
					fetchError({
						url: pageUrl,
						message:
							error instanceof Error
								? error.message
								: "Failed to read response",
						retryable: false,
						attempts: 1,
						cause: error,
					}),
				);
			}
			const pattern =
				/href=["'](\/cjenici\/download\?title=([^"'&]+)[^"']*)["']/g;
			let match: RegExpExecArray | null;
			let found = false;
			while ((match = pattern.exec(html)) !== null) {
				const href = match[1];
				const encodedFilename = match[2];
				const fileUrl = this.resolveUrl(href);
				if (seen.has(fileUrl)) {
					continue;
				}
				seen.add(fileUrl);
				const filename = this.ensureCsvExtension(
					this.decodeFilename(encodedFilename),
				);
				const fileDate = this.extractDateFromFilename(filename);
				if (date && fileDate && fileDate !== date) {
					continue;
				}
				found = true;
				discovered.push({
					url: fileUrl,
					filename,
					type: "csv",
					lastModified: new Date(),
					metadata: {
						source: "konzum_portal",
						discoveredAt: new Date().toISOString(),
						portalDate: fileDate,
						page: String(page),
					},
				});
			}
			if (!found) {
				break;
			}
		}

		return ok(discovered);
	}

	parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError> {
		return super.parse(content, filename, options);
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const match = filename.match(/,(\d{4}),/);
		if (match?.[1]) {
			return match[1];
		}
		const fallbackMatch = filename.match(/\b(\d{4})\b/);
		if (fallbackMatch?.[1]) {
			return fallbackMatch[1];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}

	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
		const baseName = file.filename.replace(/\.(csv|CSV)$/i, "");
		const parts = baseName
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		const storeCode = this.extractStoreIdentifierFromFilename(file.filename);

		const codeIndex = parts.indexOf(storeCode);
		if (codeIndex >= 0) {
			let cityIndex = codeIndex + 1;
			while (cityIndex < parts.length && isDateLike(parts[cityIndex] ?? "")) {
				cityIndex += 1;
			}

			let addressIndex = cityIndex + 1;
			while (
				addressIndex < parts.length &&
				isDateLike(parts[addressIndex] ?? "")
			) {
				addressIndex += 1;
			}

			const city = normalizeKonzumPart(parts[cityIndex] ?? "");
			const address = normalizeKonzumPart(parts[addressIndex] ?? "");

			if (city || address) {
				const storeName = city
					? `${this.name} ${city}`
					: `${this.name} ${storeCode}`;
				return {
					name: storeName,
					address: address || undefined,
					city: city || undefined,
				};
			}
		}

		return {
			name: `${this.name} ${storeCode || baseName}`,
		};
	}

	private resolveUrl(href: string): string {
		if (href.startsWith("http://") || href.startsWith("https://")) {
			return href;
		}
		const base = new URL(this.baseUrl());
		return `${base.protocol}//${base.host}${href}`;
	}

	private decodeFilename(encoded: string): string {
		try {
			return decodeURIComponent(encoded.replace(/\+/g, " "));
		} catch {
			return encoded.replace(/\+/g, " ");
		}
	}

	private ensureCsvExtension(filename: string): string {
		return filename.toLowerCase().endsWith(".csv")
			? filename
			: `${filename}.csv`;
	}

	private extractDateFromFilename(filename: string): string {
		const isoMatch = filename.match(/\d{4}-\d{2}-\d{2}/);
		if (isoMatch) {
			return isoMatch[0];
		}
		const croatianMatch = filename.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
		if (croatianMatch) {
			return `${croatianMatch[3]}-${croatianMatch[2]}-${croatianMatch[1]}`;
		}
		return "";
	}
}

function normalizeKonzumPart(value: string): string {
	return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function isDateLike(s: string): boolean {
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
	if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return true;
	if (/^\d{2}\.\d{2}\.\d{4}\.$/.test(s)) return true;
	return false;
}
