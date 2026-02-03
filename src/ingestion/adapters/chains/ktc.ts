import type { DiscoveredFile } from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";
import type { CsvColumnMapping } from "../../parsers/csv";

const ktcColumnMapping: CsvColumnMapping = {
	externalId: "Šifra proizvoda",
	name: "Naziv proizvoda",
	category: "Kategorija",
	brand: "Marka proizvoda",
	unit: "Jedinica mjere",
	unitQuantity: "Neto količina",
	price: "Maloprodajna cijena",
	discountPrice: "MPC za vrijeme posebnog oblika prodaje",
	barcodes: "Barkod",
	unitPrice: "Cijena za jedinicu mjere",
	lowestPrice30d: "Najniža cijena u posljednjih 30 dana",
};

const ktcColumnMappingAlt: CsvColumnMapping = {
	externalId: "Sifra proizvoda",
	name: "Naziv proizvoda",
	category: "Kategorija",
	brand: "Marka proizvoda",
	unit: "Jedinica mjere",
	unitQuantity: "Neto kolicina",
	price: "Maloprodajna cijena",
	discountPrice: "MPC za vrijeme posebnog oblika prodaje",
	barcodes: "Barkod",
	unitPrice: "Cijena za jedinicu mjere",
	lowestPrice30d: "Najniza cijena u posljednjih 30 dana",
};

export class KtcAdapter extends BaseCsvAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.ktc;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^TRGOVINA[_-]?",
					"(?i)^KTC[_-]?",
					"(?i)^cjenik[_-]?",
				],
			},
			columnMapping: ktcColumnMapping,
			alternativeColumnMapping: ktcColumnMappingAlt,
		});
	}

	setDiscoveryDate(date: string): void {
		this.discoveryDate = date;
	}

	async discover(targetDate?: string): Promise<DiscoveredFile[]> {
		const discovered: DiscoveredFile[] = [];
		const seenUrls = new Set<string>();
		let filterDate = targetDate || this.discoveryDate;
		if (!filterDate) {
			filterDate = new Date().toISOString().slice(0, 10);
		}

		const response = await this.fetchWithRetry(this.baseUrl());
		if (!response.ok) {
			throw new Error(`Failed to fetch KTC portal: status ${response.status}`);
		}
		const html = await response.text();
		const storePattern = /poslovnica=([^"&]+)/g;
		const stores: string[] = [];
		const seenStores = new Set<string>();
		let storeMatch: RegExpExecArray | null;
		while ((storeMatch = storePattern.exec(html)) !== null) {
			const storeName = safeDecodeURIComponent(storeMatch[1]);
			if (!seenStores.has(storeName)) {
				seenStores.add(storeName);
				stores.push(storeName);
			}
		}

		for (const storeName of stores) {
			const storeUrl = `${this.baseUrl()}?poslovnica=${encodeURIComponent(storeName)}`;
			const storeResponse = await this.fetchWithRetry(storeUrl);
			if (!storeResponse.ok) {
				continue;
			}
			const storeHtml = await storeResponse.text();
			const csvPattern = /href="([^"]*\.csv)"/gi;
			let csvMatch: RegExpExecArray | null;
			while ((csvMatch = csvPattern.exec(storeHtml)) !== null) {
				const href = csvMatch[1];
				const fileUrl = href.startsWith("http") ? href : `${this.baseUrl()}/${href.replace(/^\//, "")}`;
				if (seenUrls.has(fileUrl)) {
					continue;
				}
				seenUrls.add(fileUrl);
				const filename = this.extractFilenameFromUrl(fileUrl);
				const fileDate = this.extractDateFromFilename(filename);
				if (filterDate && fileDate && fileDate !== filterDate) {
					continue;
				}
				const lastModified = fileDate ? new Date(fileDate) : undefined;
				discovered.push({
					url: fileUrl,
					filename,
					type: "csv",
					lastModified,
					metadata: {
						source: "ktc_portal",
						discoveredAt: new Date().toISOString(),
						storeName,
						portalDate: fileDate,
					},
				});
			}
		}

		return discovered;
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const match = filename.match(/(PJ[\dA-Z]+-\d+)-\d{8}-\d{6}\.csv$/);
		if (match?.[1]) {
			return match[1];
		}
		const simpleMatch = filename.match(/(PJ[\dA-Z]+)-\d+-\d{8}/);
		if (simpleMatch?.[1]) {
			return simpleMatch[1];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}

	private extractDateFromFilename(filename: string): string {
		const match = filename.match(/(\d{4})(\d{2})(\d{2})-\d{6}\.csv$/);
		if (match) {
			return `${match[1]}-${match[2]}-${match[3]}`;
		}
		return "";
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
}

function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
