import type { DiscoveredFile, ExpandedFile, ParseOptions, ParseResult } from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";
import type { CsvColumnMapping } from "../../parsers/csv";
import { expandZip } from "../../parsers/zip";

const plodineColumnMapping: CsvColumnMapping = {
	externalId: "Sifra proizvoda",
	name: "Naziv proizvoda",
	category: "Kategorija proizvoda",
	brand: "Marka proizvoda",
	unit: "Jedinica mjere",
	unitQuantity: "Neto kolicina",
	price: "Maloprodajna cijena",
	discountPrice: "MPC za vrijeme posebnog oblika prodaje",
	barcodes: "Barkod",
	unitPrice: "Cijena po JM",
	lowestPrice30d: "Najniza cijena u poslj. 30 dana",
	anchorPrice: "Sidrena cijena",
};

const plodineColumnMappingAlt: CsvColumnMapping = {
	externalId: "Šifra",
	name: "Naziv",
	category: "Kategorija",
	brand: "Marka",
	unit: "Mjerna jedinica",
	unitQuantity: "Količina",
	price: "Cijena",
	discountPrice: "Akcijska cijena",
	discountStart: "Početak akcije",
	discountEnd: "Kraj akcije",
	barcodes: "Barkod",
	unitPrice: "Cijena za jedinicu mjere",
	lowestPrice30d: "Najniža cijena u zadnjih 30 dana",
	anchorPrice: "Sidrena cijena",
	unitPriceBaseQuantity: "Količina za jedinicu mjere",
	unitPriceBaseUnit: "Jedinica mjere za cijenu",
	anchorPriceAsOf: "Datum sidrene cijene",
};

export class PlodineAdapter extends BaseCsvAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.plodine;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^Plodine[_-]?",
					"(?i)^cjenik[_-]?",
					"(?i)^cjenici[_-]?",
				],
				fileExtensionPattern: /\.(csv|CSV|zip|ZIP)$/,
			},
			columnMapping: plodineColumnMapping,
			alternativeColumnMapping: plodineColumnMappingAlt,
		});
	}

	setDiscoveryDate(date: string): void {
		this.discoveryDate = date;
	}

	async discover(targetDate?: string): Promise<DiscoveredFile[]> {
		const discovered: DiscoveredFile[] = [];
		const seen = new Set<string>();

		let date = targetDate || this.discoveryDate;
		if (!date) {
			date = new Date().toISOString().slice(0, 10);
		}

		const parts = date.split("-");
		if (parts.length !== 3) {
			throw new Error(`Invalid date format: ${date} (expected YYYY-MM-DD)`);
		}
		const targetPattern = `${parts[2]}_${parts[1]}_${parts[0]}`;

		const response = await this.fetchWithRetry(this.baseUrl());
		if (!response.ok) {
			throw new Error(`Failed to fetch Plodine portal: status ${response.status}`);
		}
		const html = await response.text();

		const patterns = [
			/href=["'](https:\/\/[^"']*\/cjenici\/cjeniki_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']/gi,
			/href=["'](https:\/\/[^"']*\/cjenici_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']/gi,
			/href=["']([^"']*cjenici_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']/gi,
		];

		for (const pattern of patterns) {
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(html)) !== null) {
				const rawUrl = match[1];
				const fileDatePattern = match[2];
				if (fileDatePattern !== targetPattern) {
					continue;
				}
				const fileUrl = rawUrl.startsWith("http") ? rawUrl : `https://www.plodine.hr${rawUrl}`;
				if (seen.has(fileUrl)) {
					continue;
				}
				seen.add(fileUrl);
				const filename = fileUrl.slice(fileUrl.lastIndexOf("/") + 1);
				discovered.push({
					url: fileUrl,
					filename,
					type: "zip",
					lastModified: new Date(date),
					metadata: {
						source: "plodine_portal",
						discoveredAt: new Date().toISOString(),
						portalDate: date,
						fileDatePattern,
					},
				});
			}
			if (discovered.length > 0) {
				break;
			}
		}

		return discovered;
	}

	async expandZip(content: Buffer, filename: string): Promise<ExpandedFile[]> {
		const expanded = await expandZip(content, filename);
		const processed = expanded.map((file) =>
			file.type === "csv"
				? { ...file, content: this.preprocessCsvContent(file.content) }
				: file,
		);
		return processed.filter((file) => file.type === "csv");
	}

	async parse(content: Buffer, filename: string, options?: ParseOptions): Promise<ParseResult> {
		const preprocessed = this.preprocessCsvContent(content);
		return super.parse(preprocessed, filename, options);
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const baseName = filename.replace(/\.(csv|CSV)$/i, "");
		const parts = baseName.split("_");
		if (parts.length >= 6) {
			return parts[5];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}

	private preprocessCsvContent(content: Buffer): Buffer {
		let text = content.toString("utf-8");
		text = text.replace(/Sidrena cijena na \d+\.\d+\.\d+/g, "Sidrena cijena");
		text = text.replace(/;,([0-9])/g, ";0,$1");
		text = text.replace(/^,([0-9])/g, "0,$1");
		text = text.replace(/",([0-9])/g, '"0,$1');
		return Buffer.from(text);
	}
}
