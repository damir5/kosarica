import type { CsvColumnMapping } from "../../parsers/csv";
import type { DiscoveredFile } from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";

interface IntersparJsonFile {
	name: string;
	URL: string;
	SHA: string;
}

interface IntersparJsonResponse {
	files: IntersparJsonFile[];
}

const intersparColumnMapping: CsvColumnMapping = {
	externalId: "šifra",
	name: "naziv",
	category: "kategorija proizvoda",
	brand: "marka",
	unit: "jedinica mjere",
	unitQuantity: "neto količina",
	price: "MPC (EUR)",
	discountPrice: "MPC za vrijeme posebnog oblika prodaje (EUR)",
	barcodes: "barkod",
	unitPrice: "cijena za jedinicu mjere (EUR)",
	lowestPrice30d: "Najniža cijena u posljednjih 30 dana (EUR)",
	anchorPrice: "sidrena cijena na 2.5.2025. (EUR)",
};

const intersparColumnMappingAlt: CsvColumnMapping = {
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

export class IntersparAdapter extends BaseCsvAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.interspar;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^Interspar[_-]?",
					"(?i)^Spar[_-]?",
					"(?i)^cjenik[_-]?",
				],
			},
			columnMapping: intersparColumnMapping,
			alternativeColumnMapping: intersparColumnMappingAlt,
		});
	}

	setDiscoveryDate(date: string): void {
		this.discoveryDate = date;
	}

	async discover(targetDate?: string): Promise<DiscoveredFile[]> {
		let date = targetDate || this.discoveryDate;
		if (!date) {
			date = new Date().toISOString().slice(0, 10);
		}
		const dateForApi = date.replace(/-/g, "");
		const apiUrl = `https://www.spar.hr/datoteke_cjenici/Cjenik${dateForApi}.json`;

		const response = await this.fetchWithRetry(apiUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch Interspar JSON API: status ${response.status}`,
			);
		}
		const data = (await response.json()) as IntersparJsonResponse;
		if (!data.files || data.files.length === 0) {
			return [];
		}

		return data.files.map((file) => ({
			url: file.URL,
			filename: file.name,
			type: "csv",
			lastModified: new Date(date),
			metadata: {
				source: "interspar_json_api",
				discoveredAt: new Date().toISOString(),
				portalDate: date,
				sha: file.SHA,
			},
		}));
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const baseName = filename.replace(/\.(csv|CSV)$/i, "");
		const match = baseName.match(/[_-](\d{4})[_-]/);
		if (match?.[1]) {
			return match[1];
		}
		const locationMatch = baseName.match(
			/^(?:Interspar|Spar)[_-]?(.+?)(?:[_-]\d{4}[_-]\d{2}[_-]\d{2})?$/i,
		);
		if (locationMatch?.[1]) {
			return locationMatch[1];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}
}
