import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "@/lib/errors";
import type { IngestionClassified } from "../../errors";
import type { CsvColumnMapping } from "../../parsers/csv";
import type { DiscoveredFile, StoreMetadata } from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";

interface KauflandAsset {
	label: string;
	path: string;
}

const kauflandAssetAPIURL =
	"https://www.kaufland.hr/akcije-novosti/popis-mpc.assetSearch.id=assetList_1599847924.json";

const kauflandColumnMapping: CsvColumnMapping = {
	externalId: "šifra proizvoda",
	name: "naziv proizvoda",
	category: "kategorija proizvoda",
	brand: "marka proizvoda",
	unit: "jedinica mjere",
	unitQuantity: "neto količina(KG)",
	price: "maloprod.cijena(EUR)",
	discountPrice: "akc.cijena, A=akcija",
	barcodes: "barkod",
	unitPrice: "cijena jed.mj.(EUR)",
	lowestPrice30d: "Najniža MPC u 30dana",
	anchorPrice: "Sidrena cijena",
	unitPriceBaseQuantity: "kol.jed.mj.",
	unitPriceBaseUnit: "jed.mj. (1 KOM/L/KG)",
};

const kauflandColumnMappingAlt: CsvColumnMapping = {
	externalId: "Šifra",
	name: "Naziv",
	category: "Kategorija",
	brand: "Marka",
	unit: "Mjerna jedinica",
	unitQuantity: "Količina",
	price: "Cijena",
	discountPrice: "Akcijska cijena",
	barcodes: "Barkod",
	unitPrice: "Cijena za jedinicu mjere",
	lowestPrice30d: "Najniža cijena u zadnjih 30 dana",
	anchorPrice: "Sidrena cijena",
	unitPriceBaseQuantity: "Količina za jedinicu mjere",
	unitPriceBaseUnit: "Jedinica mjere za cijenu",
};

export class KauflandAdapter extends BaseCsvAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.kaufland;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^Kaufland[_-]?",
					"(?i)^cjenik[_-]?",
					"(?i)^Hipermarket[_-]?",
					"(?i)^Supermarket[_-]?",
				],
			},
			columnMapping: kauflandColumnMapping,
			alternativeColumnMapping: kauflandColumnMappingAlt,
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

		const parts = date.split("-");
		if (parts.length !== 3) {
			return errAsync(
				fetchError({
					url: kauflandAssetAPIURL,
					message: `Invalid date format: ${date} (expected YYYY-MM-DD)`,
					retryable: false,
					attempts: 0,
				}),
			);
		}
		const targetPattern = `${parts[2]}${parts[1]}${parts[0]}`;

		return this.fetchWithRetry(kauflandAssetAPIURL)
			.andThen((response) =>
				ResultAsync.fromPromise(response.json(), (e) =>
					fetchError({
						url: kauflandAssetAPIURL,
						message:
							e instanceof Error ? e.message : "Failed to parse JSON response",
						retryable: false,
						attempts: 1,
						cause: e,
					}),
				),
			)
			.andThen((data) => {
				const assets = data as KauflandAsset[];

				for (const asset of assets) {
					const filename = asset.label;
					const dateMatch = filename.match(/_(\d{8})_/);
					if (!dateMatch?.[1] || dateMatch[1] !== targetPattern) {
						continue;
					}
					const fileUrl = `https://www.kaufland.hr${asset.path}`;
					if (seen.has(fileUrl)) {
						continue;
					}
					seen.add(fileUrl);
					discovered.push({
						url: fileUrl,
						filename,
						type: "csv",
						lastModified: new Date(date),
						metadata: {
							source: "kaufland_api",
							discoveredAt: new Date().toISOString(),
							portalDate: date,
							fileDatePattern: dateMatch[1],
						},
					});
				}

				return okAsync(discovered);
			});
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const match = filename.match(/_(\d{4})_\d{8}_/);
		if (match?.[1]) {
			return match[1];
		}
		const fallbackMatch = filename.match(/_(\d{4})_/);
		if (fallbackMatch?.[1]) {
			return fallbackMatch[1];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}

	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
		const baseName = file.filename.replace(/\.(csv|CSV)$/i, "");
		const parts = baseName.split("_").filter(Boolean);
		if (parts.length < 6) {
			const identifier = this.extractStoreIdentifierFromFilename(file.filename);
			return identifier ? { name: `${this.name} ${identifier}` } : null;
		}

		const locationParts = parts.slice(1, -3);
		if (locationParts.length < 2) {
			const identifier = this.extractStoreIdentifierFromFilename(file.filename);
			return { name: `${this.name} ${identifier || baseName}` };
		}

		const splitIndex = getStreetCitySplitIndex(locationParts);
		let streetParts = locationParts.slice(0, splitIndex);
		let cityParts = locationParts.slice(splitIndex);
		if (streetParts.length === 0 || cityParts.length === 0) {
			streetParts = locationParts.slice(0, locationParts.length - 1);
			cityParts = locationParts.slice(locationParts.length - 1);
		}

		const address = normalizeKauflandPart(streetParts.join(" "));
		const city = normalizeKauflandPart(cityParts.join(" "));
		const storeName = city ? `${this.name} ${city}` : this.name;

		return {
			name: storeName,
			address: address || undefined,
			city: city || undefined,
		};
	}
}

function getStreetCitySplitIndex(parts: string[]): number {
	const houseNumberIndex = parts.findLastIndex(
		(part, index) => index < parts.length - 1 && /^\d+[A-Za-z]?$/i.test(part),
	);
	if (houseNumberIndex >= 0) {
		return houseNumberIndex + 1;
	}
	return parts.length - 1;
}

function normalizeKauflandPart(value: string): string {
	return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
