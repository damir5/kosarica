import type { XmlFieldMapping } from "../../parsers/xml";
import { expandZip } from "../../parsers/zip";
import type {
	DiscoveredFile,
	ExpandedFile,
	ParseOptions,
	ParseResult,
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

	async discover(targetDate?: string): Promise<DiscoveredFile[]> {
		const discovered: DiscoveredFile[] = [];
		const seen = new Set<string>();
		let filterDate = targetDate || this.discoveryDate;
		if (!filterDate) {
			filterDate = new Date().toISOString().slice(0, 10);
		}

		const response = await this.fetchWithRetry(this.baseUrl());
		if (!response.ok) {
			throw new Error(
				`Failed to fetch Studenac portal: status ${response.status}`,
			);
		}
		const html = await response.text();
		const pattern = /href=["']([^"']*\.zip(?:\?[^"']*)?)["']/gi;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(html)) !== null) {
			const href = match[1];
			const fileUrl = this.resolveUrl(href);
			if (seen.has(fileUrl)) {
				continue;
			}
			seen.add(fileUrl);
			const filename = this.extractFilenameFromUrl(fileUrl);
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

		return discovered;
	}

	async parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): Promise<ParseResult> {
		const result = await super.parse(content, filename, options);
		const storeId = this.extractStoreIdentifierFromFilename(filename);

		for (const row of result.rows) {
			if (!row.storeIdentifier && storeId) {
				row.storeIdentifier = storeId;
			}
		}

		return result;
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const match = filename.match(/-T(\d+)-/);
		if (match?.[1]) {
			return match[1];
		}
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
		const expanded = await expandZip(content, filename);
		return expanded.filter((file) => file.type === "xml");
	}

	protected extractFilenameFromUrl(fileUrl: string): string {
		try {
			const parsed = new URL(fileUrl);
			const parts = parsed.pathname.split("/");
			return parts[parts.length - 1] ?? fileUrl;
		} catch {
			return fileUrl;
		}
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
}
