import type { CsvColumnMapping } from "../../parsers/csv";
import type { DiscoveredFile, ParseOptions, ParseResult } from "../../types";
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

	async discover(targetDate?: string): Promise<DiscoveredFile[]> {
		const discovered: DiscoveredFile[] = [];
		const seen = new Set<string>();
		const date = targetDate || new Date().toISOString().slice(0, 10);
		const maxPages = 50;

		for (let page = 1; page <= maxPages; page += 1) {
			const pageUrl = `${this.baseUrl()}?date=${date}&page=${page}`;
			const response = await this.fetchWithRetry(pageUrl);
			if (!response.ok) {
				break;
			}
			const html = await response.text();
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

		return discovered;
	}

	async parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): Promise<ParseResult> {
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
