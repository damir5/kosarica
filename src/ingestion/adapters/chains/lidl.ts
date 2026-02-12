import { okAsync, ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "@/lib/errors";
import type { IngestionClassified } from "../../errors";
import type { CsvColumnMapping } from "../../parsers/csv";
import { expandZip } from "../../parsers/zip";
import type {
	DiscoveredFile,
	ExpandedFile,
	ParseOptions,
	ParseResult,
	StoreMetadata,
} from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";

const lidlColumnMapping: CsvColumnMapping = {
	externalId: "ŠIFRA",
	name: "NAZIV",
	category: "KATEGORIJA_PROIZVODA",
	brand: "MARKA",
	unit: "JEDINICA_MJERE",
	unitQuantity: "NETO_KOLIČINA",
	price: "MALOPRODAJNA_CIJENA",
	discountPrice: "MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE",
	barcodes: "BARKOD",
	unitPrice: "CIJENA_ZA_JEDINICU_MJERE",
	lowestPrice30d: "NAJNIZA_CIJENA_U_POSLJ._30_DANA",
	anchorPrice: "Sidrena_cijena_na_dan",
};

const lidlColumnMappingAlt: CsvColumnMapping = {
	externalId: "Artikl",
	name: "Naziv artikla",
	category: "Kategorija",
	brand: "Robna marka",
	unit: "Jedinica mjere",
	unitQuantity: "Količina",
	price: "Cijena",
	discountPrice: "Akcijska cijena",
	discountStart: "Početak akcije",
	discountEnd: "Završetak akcije",
	barcodes: "GTIN",
};

export class LidlAdapter extends BaseCsvAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.lidl;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^Lidl[_-]?",
					"(?i)^Popis_cijena[_-]?",
					"(?i)^cjenik[_-]?",
					"^\\d{4}[_-]\\d{2}[_-]\\d{2}[_-]?",
				],
				fileExtensionPattern: /\.(csv|CSV|zip|ZIP)$/,
			},
			columnMapping: lidlColumnMapping,
			alternativeColumnMapping: lidlColumnMappingAlt,
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
				const patterns = [
					/href=["'](https:\/\/tvrtka\.lidl\.hr\/content\/download\/\d+\/fileupload\/([^"']+\.zip))["']/g,
					/href=["'](\/content\/download\/\d+\/fileupload\/([^"']+\.zip))["']/g,
				];

				for (const pattern of patterns) {
					let match: RegExpExecArray | null;
					while ((match = pattern.exec(html)) !== null) {
						const rawUrl = match[1];
						const filename = match[2];
						const fileUrl = rawUrl.startsWith("http")
							? rawUrl
							: `https://tvrtka.lidl.hr${rawUrl}`;
						if (seen.has(fileUrl)) {
							continue;
						}
						seen.add(fileUrl);
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
								source: "lidl_portal",
								discoveredAt: new Date().toISOString(),
								portalDate: fileDate,
							},
						});
					}
				}

				return okAsync(discovered);
			});
	}

	async expandZip(content: Buffer, filename: string): Promise<ExpandedFile[]> {
		const expanded = await expandZip(content, filename);
		return expanded.filter((file) => file.type === "csv");
	}

	parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError> {
		return super
			.parse(content, filename, options)
			.map((result) => this.postprocessMultipleGtins(result));
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const baseName = filename.replace(/\.(csv|CSV)$/i, "");
		const dateStoreMatch = baseName.match(
			/^Lidl[_-]?\d{4}[_-]\d{2}[_-]\d{2}[_-](.+)$/i,
		);
		if (dateStoreMatch?.[1]) {
			return dateStoreMatch[1];
		}
		const locationMatch = baseName.match(/^Lidl[_-]?Poslovnica[_-]?(.+)$/i);
		if (locationMatch?.[1]) {
			return locationMatch[1];
		}
		const simpleMatch = baseName.match(/^Lidl[_-]?(\d+)$/i);
		if (simpleMatch?.[1]) {
			return simpleMatch[1];
		}
		const supermarketMatch = baseName.match(/^(Supermarket\s+\d+(?:_.+)?)$/i);
		if (supermarketMatch?.[1]) {
			return supermarketMatch[1];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}

	private postprocessMultipleGtins(result: ParseResult): ParseResult {
		for (const row of result.rows) {
			if (row.barcodes.length === 1) {
				const barcode = row.barcodes[0];
				if (barcode.includes(";") || barcode.includes("|")) {
					row.barcodes = splitGtins(barcode);
				}
			}
		}
		return result;
	}

	private extractDateFromFilename(filename: string): string {
		const match = filename.match(/(\d{2})_(\d{2})_(\d{4})\.zip$/);
		if (match) {
			return `${match[3]}-${match[2]}-${match[1]}`;
		}
		return "";
	}

	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
		const identifier = this.extractStoreIdentifierFromFilename(file.filename);
		if (!identifier) {
			return null;
		}

		const normalizedIdentifier = identifier.replace(/\.(zip|csv)$/i, "").trim();

		const supermarketOnlyMatch = normalizedIdentifier.match(
			/^Supermarket\s+(\d+)$/i,
		);
		if (supermarketOnlyMatch?.[1]) {
			return {
				name: `${this.name} ${supermarketOnlyMatch[1]}`,
			};
		}

		const supermarketWithDetailsMatch = normalizedIdentifier.match(
			/^Supermarket\s+(\d+)_(.+)$/i,
		);
		if (supermarketWithDetailsMatch) {
			const storeCode = supermarketWithDetailsMatch[1];
			const details = supermarketWithDetailsMatch[2] ?? "";
			const parts = details
				.split("_")
				.filter(
					(p) =>
						p &&
						!/^\d{8}$/.test(p) &&
						!/^\d{2}\.\d{2}\.\d{4}$/.test(p) &&
						!/^\d{1,2}\.\d{2}h?$/i.test(p) &&
						!/^\d{1,2}$/i.test(p),
				);

			if (parts.length >= 2) {
				const streetParts: string[] = [];
				const cityParts: string[] = [];
				let foundCityStart = false;

				for (const part of parts) {
					if (/^\d{5}$/.test(part)) {
						foundCityStart = true;
						continue;
					}
					if (foundCityStart) {
						cityParts.push(part);
					} else {
						streetParts.push(part);
					}
				}

				const street = streetParts.join(" ").replace(/\s+/g, " ").trim();
				const city = cityParts.join(" ").replace(/\s+/g, " ").trim();

				return {
					name: city ? `${this.name} ${city}` : `${this.name} ${storeCode}`,
					address: street || undefined,
					city: city || undefined,
				};
			}

			return {
				name: `${this.name} ${storeCode}`,
			};
		}

		if (/^\d+$/.test(normalizedIdentifier)) {
			return {
				name: `${this.name} ${normalizedIdentifier}`,
			};
		}

		const parts = normalizedIdentifier
			.split("_")
			.filter((p) => p && !/^\d{8}$/.test(p));
		if (parts.length === 0) {
			return {
				name: `${this.name} ${normalizedIdentifier}`,
			};
		}

		const city = parts[0]?.trim() ?? "";
		const address = parts.slice(1).join(" ").replace(/\s+/g, " ").trim();

		return {
			name: city
				? `${this.name} ${city}`
				: `${this.name} ${normalizedIdentifier}`,
			city: city || undefined,
			address: address || undefined,
		};
	}
}

function splitGtins(barcode: string): string[] {
	return barcode
		.split(/[;|]/)
		.map((part) => part.trim())
		.filter((part) => part !== "");
}
