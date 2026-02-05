import type { ResultAsync } from "neverthrow";
import type { FetchError } from "@/lib/errors";
import type { IngestionClassified } from "../../errors";
import type { CsvColumnMapping } from "../../parsers/csv";
import type {
	DiscoveredFile,
	ParseOptions,
	ParseResult,
	StoreIdentifier,
} from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";

const metroColumnMapping: CsvColumnMapping = {
	externalId: "SIFRA",
	name: "NAZIV",
	category: "KATEGORIJA",
	brand: "MARKA",
	unit: "JED_MJERE",
	unitQuantity: "NETO_KOLICINA",
	price: "MPC",
	discountPrice: "POSEBNA_PRODAJA",
	barcodes: "BARKOD",
	unitPrice: "CIJENA_PO_MJERI",
	lowestPrice30d: "NAJNIZA_30_DANA",
	anchorPrice: "SIDRENA",
};

const metroColumnMappingAlt: CsvColumnMapping = {
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
};

export class MetroAdapter extends BaseCsvAdapter {
	constructor() {
		const chainConfig = chainConfigs.metro;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: ["(?i)^Metro[_-]?", "(?i)^cjenik[_-]?"],
			},
			columnMapping: metroColumnMapping,
			alternativeColumnMapping: metroColumnMappingAlt,
		});
	}

	parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError> {
		const preprocessed = this.preprocessCsvContent(content);
		return super.parse(preprocessed, filename, options);
	}

	discover(
		targetDate?: string,
	): ResultAsync<DiscoveredFile[], FetchError | IngestionClassified> {
		const filterDate = targetDate || new Date().toISOString().slice(0, 10);
		return super.discover(targetDate).map((files) =>
			files.filter((file) => {
				const fileDate = this.extractDateFromFilename(file.filename);
				if (fileDate) {
					file.lastModified = new Date(fileDate);
					file.metadata = { ...file.metadata, portalDate: fileDate };
				}
				return !filterDate || fileDate === filterDate;
			}),
		);
	}

	extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null {
		const storeCode = this.extractStoreCodeFromFilename(file.filename);
		if (!storeCode) {
			return super.extractStoreIdentifier(file);
		}
		return { type: "portal_id", value: storeCode };
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		return this.extractStoreCodeFromFilename(filename);
	}

	private preprocessCsvContent(content: Buffer): Buffer {
		const text = content
			.toString("utf-8")
			.replace(/SIDRENA_\d{2}_\d{2}/g, "SIDRENA");
		return Buffer.from(text);
	}

	private extractDateFromFilename(filename: string): string {
		const match = filename.match(/METRO_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
		if (match) {
			return `${match[1]}-${match[2]}-${match[3]}`;
		}
		return "";
	}

	private extractStoreCodeFromFilename(filename: string): string {
		const match = filename.match(/_S(\d+)_/);
		if (match?.[1]) {
			return `S${match[1]}`;
		}
		return "";
	}
}
