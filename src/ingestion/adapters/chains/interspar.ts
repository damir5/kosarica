import { ResultAsync, errAsync, okAsync } from "neverthrow";
import { fetchError, type FetchError } from "@/lib/errors";
import { ingestionClassified, type IngestionClassified } from "@/ingestion/errors";
import {
	compareDateKeys,
	formatDateParts,
	getTimezoneDateParts,
	ZAGREB_TIMEZONE,
} from "@/ingestion/time";
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

				const files: DiscoveredFile[] = parsed.files.map((file) => ({
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
