import { errAsync, okAsync, ResultAsync } from "neverthrow";
import {
	type IngestionClassified,
	ingestionClassified,
} from "@/ingestion/errors";
import {
	compareDateKeys,
	formatDateParts,
	getTimezoneDateParts,
	ZAGREB_TIMEZONE,
} from "@/ingestion/time";
import { type FetchError, fetchError } from "@/lib/errors";
import type { CsvColumnMapping } from "../../parsers/csv";
import type { DiscoveredFile, StoreMetadata } from "../../types";
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

const INTERSPAR_PUBLISH_CUTOFF_HOUR = 5;

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

	discover(
		targetDate?: string,
	): ResultAsync<DiscoveredFile[], FetchError | IngestionClassified> {
		let date = targetDate || this.discoveryDate;
		if (!date) {
			date = new Date().toISOString().slice(0, 10);
		}
		const dateForApi = date.replace(/-/g, "");
		const apiUrl = `https://www.spar.hr/datoteke_cjenici/Cjenik${dateForApi}.json`;

		return this.fetchWithRetry(apiUrl)
			.andThen((response) =>
				ResultAsync.fromPromise(response.json(), (e) =>
					fetchError({
						url: apiUrl,
						message:
							e instanceof Error ? e.message : "Failed to parse JSON response",
						retryable: false,
						attempts: 1,
						cause: e,
					}),
				),
			)
			.andThen((data) => {
				const parsed = data as IntersparJsonResponse;
				if (!parsed.files || parsed.files.length === 0) {
					return okAsync<DiscoveredFile[]>([]);
				}

				const seenUrls = new Set<string>();
				const seenFilenames = new Set<string>();
				const files: DiscoveredFile[] = [];

				for (const file of parsed.files) {
					const fileUrl = file.URL;
					const filename = file.name;

					// Skip duplicates
					if (seenUrls.has(fileUrl) || seenFilenames.has(filename)) {
						continue;
					}
					seenUrls.add(fileUrl);
					seenFilenames.add(filename);

					files.push({
						url: fileUrl,
						filename,
						type: "csv",
						lastModified: new Date(date),
						metadata: {
							source: "interspar_json_api",
							discoveredAt: new Date().toISOString(),
							portalDate: date,
							sha: file.SHA,
						},
					});
				}

				return okAsync(files);
			})
			.orElse((error) => {
				if (error._tag === "FetchError" && error.status === 404) {
					const noDataState = getIntersparNoDataState(date);
					if (noDataState.retryAt) {
						return errAsync(
							ingestionClassified({
								status: "completed",
								statusType: "source_not_published_yet",
								statusSeverity: "warning",
								statusReason: `Interspar index not published yet for ${date}; retry scheduled hourly until ${INTERSPAR_PUBLISH_CUTOFF_HOUR}:00 ${ZAGREB_TIMEZONE}`,
								retryAt: noDataState.retryAt,
								metadata: {
									targetDate: date,
									sourceUrl: apiUrl,
									cutoffHourLocal: INTERSPAR_PUBLISH_CUTOFF_HOUR,
									timezone: ZAGREB_TIMEZONE,
								},
							}),
						);
					}

					return errAsync(
						ingestionClassified({
							status: "completed",
							statusType: "source_no_data",
							statusSeverity: "warning",
							statusReason: `Interspar index not published for ${date} by ${INTERSPAR_PUBLISH_CUTOFF_HOUR}:00 ${ZAGREB_TIMEZONE}`,
							metadata: {
								targetDate: date,
								sourceUrl: apiUrl,
								cutoffHourLocal: INTERSPAR_PUBLISH_CUTOFF_HOUR,
								timezone: ZAGREB_TIMEZONE,
							},
						}),
					);
				}

				return errAsync(error);
			});
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const baseName = filename.replace(/\.(csv|CSV)$/i, "");
		const match = baseName.match(/[_-](\d{4,5})[_-]/);
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

	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
		const baseName = file.filename.replace(/\.(csv|CSV)$/i, "");
		const parts = baseName.split("_").filter(Boolean);
		if (parts.length < 6) {
			const identifier = this.extractStoreIdentifierFromFilename(file.filename);
			return identifier ? { name: `${this.name} ${identifier}` } : null;
		}

		const storeCode = this.extractStoreIdentifierFromFilename(file.filename);
		const storeCodeIndex = parts.lastIndexOf(storeCode);

		if (storeCodeIndex < 2) {
			return { name: `${this.name} ${storeCode}` };
		}

		const cityFromSuffix = extractCityFromSuffix(parts, storeCodeIndex);
		if (cityFromSuffix) {
			const addressStartIndex = findAddressStart(
				parts.slice(1, storeCodeIndex),
			);
			const addressTokens = parts.slice(
				// addressStartIndex is relative to parts.slice(1, storeCodeIndex)
				addressStartIndex + 2,
				storeCodeIndex,
			);
			const address = normalizeIntersparPart(addressTokens.join(" "));
			return {
				name: `${this.name} ${cityFromSuffix}`,
				address: address || undefined,
				city: cityFromSuffix,
			};
		}

		const addressStartIndex = findAddressStart(parts.slice(1, storeCodeIndex));
		// addressStartIndex is relative to parts.slice(1, storeCodeIndex)
		const cityTokens = parts.slice(1, addressStartIndex + 2);
		const addressTokens = parts.slice(addressStartIndex + 2, storeCodeIndex);

		const city = normalizeIntersparPart(cityTokens.join(" "));
		const address = normalizeIntersparPart(addressTokens.join(" "));
		const storeName = city
			? `${this.name} ${city}`
			: `${this.name} ${storeCode}`;

		return {
			name: storeName.trim(),
			address: address || undefined,
			city: city || undefined,
		};
	}
}

function getIntersparNoDataState(targetDate: string): {
	retryAt?: Date;
} {
	const now = new Date();
	const nowInZagreb = getTimezoneDateParts(now, ZAGREB_TIMEZONE);
	const localDate = formatDateParts(nowInZagreb);
	const dateComparison = compareDateKeys(localDate, targetDate);
	const beforeCutoffToday =
		dateComparison === 0 && nowInZagreb.hour < INTERSPAR_PUBLISH_CUTOFF_HOUR;

	if (beforeCutoffToday) {
		return { retryAt: new Date(now.getTime() + 60 * 60 * 1000) };
	}

	return {};
}

const ADDRESS_INDICATORS = [
	"ulica",
	"cesta",
	"avenija",
	"trg",
	"aleja",
	"šetalište",
	"prilaz",
	"natrag",
];

function extractCityFromSuffix(
	parts: string[],
	storeCodeIndex: number,
): string | null {
	const brandMarkers = ["spar", "esp", "interspar"];
	for (let i = storeCodeIndex + 1; i < parts.length - 1; i++) {
		const part = parts[i].toLowerCase();
		if (brandMarkers.includes(part)) {
			const cityTokens: string[] = [];
			for (let j = i + 1; j < parts.length; j++) {
				const token = parts[j];
				if (/^\d{4}$/.test(token)) break;
				cityTokens.push(token);
			}
			if (cityTokens.length > 0) {
				// Many real Interspar filenames include internal location codes after the
				// store code (e.g. `spar_zg_jurisiceva_0281_...`). Treat short prefixes
				// like `zg`/`os` as non-city to avoid misclassifying the address/city.
				const first = cityTokens[0]?.toLowerCase() ?? "";
				if (/^[a-z]{1,3}$/.test(first)) {
					return null;
				}
				return normalizeIntersparPart(cityTokens.join(" "));
			}
		}
	}
	return null;
}

function findAddressStart(parts: string[]): number {
	const hasIndicator = parts.some((raw) =>
		ADDRESS_INDICATORS.includes(raw.toLowerCase().replace(/\./g, "")),
	);
	if (!hasIndicator) {
		// Common filename format is `<city>_<street...>_<house>_<storeCode>_...`.
		// Without explicit street indicators, treat the first token as the city.
		return 0;
	}

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i].toLowerCase().replace(/\./g, "");
		if (ADDRESS_INDICATORS.includes(part)) {
			// Pattern usually looks like `<city>_<street>_<indicator>_...`.
			// Return the last city token index (token before street starts).
			return Math.max(0, i - 2);
		}
		if (/^\d+[a-z]?$/.test(part) && i > 0) {
			return i - 1;
		}
	}
	return Math.min(1, parts.length - 1);
}

function normalizeIntersparPart(value: string): string {
	if (!value) return "";
	return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
