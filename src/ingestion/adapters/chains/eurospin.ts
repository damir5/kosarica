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
	StoreIdentifier,
	StoreMetadata,
} from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";

const eurospinColumnMapping: CsvColumnMapping = {
	externalId: "ŠIFRA_PROIZVODA",
	name: "NAZIV_PROIZVODA",
	category: "KATEGORIJA_PROIZVODA",
	brand: "MARKA_PROIZVODA",
	unit: "JEDINICA_MJERE",
	unitQuantity: "NETO_KOLIČINA",
	price: "MALOPROD.CIJENA(EUR)",
	discountPrice: "MPC_POSEB.OBLIK_PROD",
	discountStart: "POČETAK_AKCIJE",
	discountEnd: "KRAJ_AKCIJE",
	barcodes: "BARKOD",
	unitPrice: "CIJENA_ZA_JEDINICU_MJERE",
	lowestPrice30d: "NAJNIŽA_MPC_U_30DANA",
	anchorPrice: "SIDRENA_CIJENA",
	unitPriceBaseQuantity: "KOLIČINA_ZA_JEDINICU_MJERE",
	unitPriceBaseUnit: "JEDINICA_MJERE_ZA_CIJENU",
	anchorPriceAsOf: "DATUM_SIDRENE_CIJENE",
};

const eurospinColumnMappingAlt: CsvColumnMapping = {
	externalId: "SIFRA_PROIZVODA",
	name: "NAZIV_PROIZVODA",
	category: "KATEGORIJA",
	brand: "MARKA",
	unit: "JM",
	unitQuantity: "NETO_KOLICINA",
	price: "MALOPROD_CIJENA",
	discountPrice: "MPC_POSEB_OBLIK_PROD",
	discountStart: "Pocetak_akcije",
	discountEnd: "Kraj_akcije",
	barcodes: "BARKOD",
	unitPrice: "CIJENA_ZA_JEDINICU_MJERE",
	lowestPrice30d: "NAJNIZA_MPC_U_30DANA",
	anchorPrice: "SIDRENA_CIJENA",
	unitPriceBaseQuantity: "KOLICINA_ZA_JM",
	unitPriceBaseUnit: "JM_ZA_CIJENU",
	anchorPriceAsOf: "DATUM_SIDRENE_CIJENE",
};

export class EurospinAdapter extends BaseCsvAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.eurospin;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^Eurospin[_-]?",
					"(?i)^cjenik[_-]?",
					"(?i)^diskontna[_-]?",
				],
				fileExtensionPattern: /\.(csv|CSV|xml|XML|zip|ZIP)$/,
			},
			columnMapping: eurospinColumnMapping,
			alternativeColumnMapping: eurospinColumnMappingAlt,
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
		let date = targetDate || this.discoveryDate;
		if (!date) {
			date = new Date().toISOString().slice(0, 10);
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
				const optionPattern =
					/<option[^>]*value=["']([^"']*cjenik_[^"']*\.zip)["'][^>]*>([^<]*)<\/option>/gi;
				let match: RegExpExecArray | null;
				while ((match = optionPattern.exec(html)) !== null) {
					const rawUrl = match[1];
					let filename = match[2]?.trim();
					const fileUrl = this.resolveUrl(rawUrl);
					if (seen.has(fileUrl)) {
						continue;
					}
					seen.add(fileUrl);
					if (!filename) {
						filename = this.extractFilenameFromUrl(fileUrl);
					}
					const fileDate = this.extractDateFromFilename(filename);
					if (date && fileDate && fileDate !== date) {
						continue;
					}
					const lastModified = fileDate ? new Date(fileDate) : undefined;
					discovered.push({
						url: fileUrl,
						filename,
						type: "zip",
						lastModified,
						metadata: {
							source: "eurospin_portal",
							discoveredAt: new Date().toISOString(),
							portalDate: fileDate,
						},
					});
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
		return super.parse(content, filename, options);
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
		const match = filename.match(/cjenik_(\d{2})\.(\d{2})\.(\d{4})/);
		if (match) {
			return `${match[3]}-${match[2]}-${match[1]}`;
		}
		return "";
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const match = filename.match(
			/(?:prodavaonica|diskontna_prodavaonica)-(\d{6})-/i,
		);
		if (match?.[1]) {
			return match[1];
		}
		const fallbackMatch = filename.match(/-(\d{6})-/);
		if (fallbackMatch?.[1]) {
			return fallbackMatch[1];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}

	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
		const baseName = file.filename.replace(/\.(csv|CSV|xml|XML)$/i, "");
		const parts = baseName.split("-");

		if (parts.length < 5) {
			const identifier = this.extractStoreIdentifierFromFilename(file.filename);
			if (!identifier) {
				return null;
			}
			return {
				name: `${this.name} ${identifier}`,
			};
		}

		const city = parts[3]?.replace(/_/g, " ").trim() || "";
		const street = parts[2]?.replace(/_/g, " ").trim() || "";
		const postalCode = parts[4]?.trim() || "";

		const storeName = city ? `${this.name} ${city}` : this.name;

		return {
			name: storeName,
			address: street || undefined,
			city: city || undefined,
			postalCode: postalCode || undefined,
		};
	}

	extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null {
		const rawIdentifier = this.extractStoreIdentifierFromFilename(
			file.filename,
		);
		if (!rawIdentifier) {
			return null;
		}

		if (/^\d{6}$/.test(rawIdentifier)) {
			return {
				type: "eurospin_store_code",
				value: rawIdentifier,
			};
		}

		return {
			type: "filename_code",
			value: rawIdentifier,
		};
	}
}
